import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Account,
  Course,
  Coverage,
  DocumentRecord,
  Notice,
  Requirement,
  ScanResult,
  Settings,
  Snapshot,
  Task,
} from "../shared/types";
import { parseDate, reminderSlots, uid } from "../domain/time";
import { preferSpoc } from "../domain/tasks";
const defaults: Settings = {
  intervalMinutes: 30,
  autoStart: false,
  quietStart: 23,
  quietEnd: 8,
  quietUrgent: true,
  notifications: true,
  scanAttachments: true,
};
type Row = { id: string; payload: string };
export class Store {
  db: Database.Database;
  constructor(public path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('schema', '1');
      CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, course_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS task_course ON tasks(course_id);
      CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS requirement_task ON requirements(task_id);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS coverage (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reminder_due ON reminders(status,at);`);
    if (
      this.db.prepare("SELECT value FROM meta WHERE key=?").get("schema") &&
      this.getMeta("schema") !== "1"
    )
      throw new Error("数据库版本不兼容，请使用对应版本应用。");
    for (const platform of ["xjtu", "icourse"] as const) {
      const account = this.get<Account>("accounts", platform);
      if (!account)
        this.put("accounts", platform, { platform, state: "unknown" });
      else if (account.state === "checking") {
        this.account(platform, {
          state: "error",
          error: "上次同步被中断；将自动重试，历史数据已保留。",
        });
        this.setMeta("nextAttempt:" + platform, "1970-01-01T00:00:00.000Z");
      }
    }
    for (const document of this.all<DocumentRecord>("documents")) {
      if (document.status === "pending")
        this.put("documents", document.id, {
          ...document,
          status: "error",
          message: "上次解析被中断，将在下一轮自动重试。",
        });
    }
    this.db
      .prepare("UPDATE reminders SET status='uncertain' WHERE status='sending'")
      .run();
    for (const notice of this.all<Notice>("notices"))
      if (notice.status === "sending")
        this.put("notices", notice.id, { ...notice, status: "uncertain" });
    this.suppressDuplicateNotices();
  }
  private valid(table: string) {
    if (
      ![
        "courses",
        "tasks",
        "requirements",
        "accounts",
        "coverage",
        "sync_runs",
        "documents",
        "events",
        "notices",
      ].includes(table)
    )
      throw new Error("Invalid table");
    return table;
  }
  all<T>(table: string): T[] {
    return (
      this.db.prepare(`SELECT payload FROM ${this.valid(table)}`).all() as Row[]
    ).map((x) => JSON.parse(x.payload));
  }
  get<T>(table: string, id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT payload FROM ${this.valid(table)} WHERE id=?`)
      .get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  put(table: string, id: string, payload: unknown) {
    this.db
      .prepare(
        `INSERT INTO ${this.valid(table)}(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,
      )
      .run(id, JSON.stringify(payload));
  }
  getMeta(key: string) {
    return (
      this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as
        { value: string } | undefined
    )?.value;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  settings(): Settings {
    return { ...defaults, ...JSON.parse(this.getMeta("settings") || "{}") };
  }
  saveSettings(value: Settings) {
    this.setMeta("settings", JSON.stringify(value));
  }
  account(platform: Account["platform"], update: Partial<Account>) {
    this.put("accounts", platform, {
      ...this.get<Account>("accounts", platform),
      ...update,
      platform,
    });
  }
  snapshot(busy: string[] = [], version = "1.0.0"): Snapshot {
    const presentation = this.presentation();
    return { ...presentation.snapshot, busy, version };
  }
  private presentation() {
    const reqs = this.all<Requirement>("requirements");
    const tasks = this.all<Task>("tasks").map((t) => ({
      ...t,
      requirements: reqs.filter((r) => r.taskId === t.id && !r.retired),
    }));
    const courses = this.all<Course>("courses");
    const preferred = preferSpoc(tasks, courses);
    return {
      aliases: preferred.aliases,
      snapshot: {
        courses: courses.map((c) => ({
          ...c,
          preferredCourseId: preferred.courseAliases.get(c.id),
        })),
        tasks: preferred.tasks,
        accounts: this.all<Account>("accounts"),
        coverage: this.all<Coverage>("coverage"),
        notices: this.all<Notice>("notices")
          .filter((n) => !n.taskId || !preferred.aliases.has(n.taskId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 300),
        documents: this.all<DocumentRecord>("documents"),
        settings: this.settings(),
        busy: [] as string[],
        nextSync: this.getMeta("nextSync") || new Date().toISOString(),
        version: "1.0.0",
      },
    };
  }
  private suppressDuplicateNotices() {
    const { aliases } = this.presentation();
    for (const n of this.all<Notice>("notices"))
      if (n.taskId && aliases.has(n.taskId) && n.status !== "superseded")
        this.put("notices", n.id, { ...n, status: "superseded" });
    for (const r of this.all<Requirement>("requirements"))
      if (aliases.has(r.taskId))
        this.db
          .prepare(
            "UPDATE reminders SET status='cancelled' WHERE requirement_id=? AND status='pending'",
          )
          .run(r.id);
  }
  merge(result: ScanResult) {
    this.db.transaction(() => {
      for (const course of result.courses)
        this.put("courses", course.id, {
          ...course,
          lastSeen: new Date().toISOString(),
        });
      for (const task of result.tasks) {
        const old = this.get<Task>("tasks", task.id);
        const next = {
          ...old,
          ...task,
          submission:
            task.submission === "unknown" && old
              ? old.submission
              : task.submission,
          body: !task.detailRead && old ? old.body : task.body,
          attachments:
            !task.detailRead && old ? old.attachments : task.attachments,
          requirements: [],
        };
        this.db
          .prepare(
            "INSERT INTO tasks(id,course_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,course_id=excluded.course_id",
          )
          .run(task.id, task.courseId, JSON.stringify(next));
        if (old && old.submission !== next.submission) {
          const at = new Date().toISOString();
          this.put("events", uid(task.id, "submission", at), {
            taskId: task.id,
            before: old.submission,
            after: next.submission,
            at,
          });
          if (
            next.submission === "needs_resubmit" ||
            (old.submission === "submitted" &&
              next.submission === "not_submitted")
          )
            this.notice(
              uid(task.id, "resubmit", at),
              "课程任务需要重新提交",
              task.title,
              task.id,
            );
        }
        for (const req of task.requirements)
          this.mergeRequirement(
            req,
            task.submission === "submitted" && req.source === "system",
          );
        if (task.detailRead && task.body.trim()) {
          const currentIds = new Set(task.requirements.map((r) => r.id));
          for (const previous of this.all<Requirement>("requirements")) {
            if (
              previous.taskId !== task.id ||
              (previous.source !== "teacher" && previous.phase !== "late") ||
              previous.evidenceUrl !== task.url ||
              previous.override ||
              previous.confidence === "review" ||
              previous.retired ||
              currentIds.has(previous.id)
            )
              continue;
            const retired = {
              ...previous,
              retired: true,
              version: previous.version + 1,
            };
            this.db
              .prepare("UPDATE requirements SET payload=? WHERE id=?")
              .run(JSON.stringify(retired), previous.id);
            this.cancelPendingNotices(previous.id);
            this.schedule(retired);
            this.put(
              "events",
              uid(previous.id, "retired", String(retired.version)),
              {
                before: previous,
                after: retired,
                at: new Date().toISOString(),
              },
            );
            this.notice(
              uid("removed-date", previous.id, String(retired.version)),
              "原文日期识别结果已更新",
              "最新读取未再识别到该项日期要求，已停止对应提醒并保留历史依据；请查看课程说明。",
              task.id,
            );
          }
        }
        if (!old && this.getMeta(`seeded:${result.platform}`))
          this.notice(
            uid("new", task.id),
            "发现新的课程任务",
            task.title,
            task.id,
          );
      }
      for (const cov of result.coverage)
        this.put("coverage", uid(cov.courseId, cov.section), cov);
      const at = new Date().toISOString();
      this.put("sync_runs", uid(result.platform, at), {
        ...result,
        tasks: result.tasks.length,
        courses: result.courses.length,
        at,
      });
      this.setMeta(`seeded:${result.platform}`, "1");
      const gaps = result.coverage.filter((c) => c.status !== "success");
      const error =
        result.error ||
        (gaps.length
          ? `${gaps.length}项入口未完整读取，请查看课程覆盖；将自动重试。`
          : undefined);
      this.account(result.platform, {
        state: result.needsLogin ? "needs_login" : error ? "error" : "ready",
        lastAttempt: at,
        ...(!error && !result.needsLogin ? { lastSuccess: at } : {}),
        error,
      });
    })();
    this.suppressDuplicateNotices();
  }
  mergeRequirement(incoming: Requirement, systemDone = false) {
    const old = this.get<
      Requirement & {
        override?: boolean;
        sourceDate?: string;
        sourceDueAt?: string;
        manualCompleted?: boolean;
      }
    >("requirements", incoming.id);
    if (old?.override) {
      if (
        old.sourceDate &&
        (old.sourceDate !== incoming.date || old.sourceDueAt !== incoming.dueAt)
      ) {
        this.notice(
          uid(
            "override-source-change",
            old.id,
            incoming.date,
            incoming.dueAt || "",
          ),
          "来源日期已更新，保留了你的校正",
          "请重新核对老师要求或系统截止时间，确认是否需要修改本地校正。",
          old.taskId,
        );
        this.db.prepare("UPDATE requirements SET payload=? WHERE id=?").run(
          JSON.stringify({
            ...old,
            sourceDate: incoming.date,
            sourceDueAt: incoming.dueAt,
          }),
          old.id,
        );
      }
      return;
    }
    const changed =
      old && (old.date !== incoming.date || old.dueAt !== incoming.dueAt);
    const done =
      incoming.source === "system"
        ? systemDone || old?.manualCompleted || false
        : old?.completed || false;
    const req = {
      ...incoming,
      completed: done,
      manualCompleted: old?.manualCompleted,
      version:
        changed || (old?.completed && !done)
          ? old!.version + 1
          : old?.version || 1,
    };
    this.db
      .prepare(
        "INSERT INTO requirements(id,task_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(req.id, req.taskId, JSON.stringify(req));
    if (changed) {
      this.cancelPendingNotices(req.id);
      this.notice(
        uid("date", req.id, String(req.version)),
        req.phase === "late"
          ? "补交截止时间有变化"
          : req.source === "teacher"
            ? "老师要求日期有变化"
            : "系统截止时间有变化",
        `${old.date} → ${req.date}${req.dueAt ? " " + new Date(req.dueAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }) : "（未注明时刻）"}`,
        req.taskId,
      );
      this.put("events", uid(req.id, String(req.version)), {
        before: old,
        after: req,
        at: new Date().toISOString(),
      });
    }
    if (!old && req.confidence === "review")
      this.notice(
        uid("candidate", req.id),
        "发现日期候选，请核对",
        req.original,
        req.taskId,
        req.id,
      );
    this.schedule(req);
  }
  schedule(req: Requirement) {
    this.db
      .prepare(
        "UPDATE reminders SET status='cancelled' WHERE requirement_id=? AND status='pending' AND version<>?",
      )
      .run(req.id, req.version);
    if (req.retired || req.completed || req.confidence === "review") {
      this.db
        .prepare(
          "UPDATE reminders SET status='cancelled' WHERE requirement_id=? AND status='pending'",
        )
        .run(req.id);
      if (req.completed) this.cancelPendingNotices(req.id);
      return;
    }
    const now = Date.now(),
      slots = reminderSlots(req),
      latest = slots.filter((x) => x <= now).at(-1);
    slots.forEach((at, index) => {
      if (at < now && at !== latest) return;
      const id = uid(req.id, String(req.version), String(index));
      this.db
        .prepare(
          "INSERT INTO reminders VALUES(?,?,?,?,'pending') ON CONFLICT(id) DO UPDATE SET status=CASE WHEN reminders.status='cancelled' THEN 'pending' ELSE reminders.status END",
        )
        .run(id, req.id, req.version, at);
    });
  }
  complete(id: string, done: boolean) {
    const req = this.get<Requirement>("requirements", id);
    if (!req) throw new Error("找不到该日期要求");
    this.db.transaction(() => {
      const updated = { ...req, completed: done, manualCompleted: done };
      this.db
        .prepare("UPDATE requirements SET payload=? WHERE id=?")
        .run(JSON.stringify(updated), id);
      this.schedule(updated);
    })();
  }
  correct(id: string, value: string) {
    const req = this.get<Requirement>("requirements", id),
      parsed = parseDate(value);
    if (!req || !parsed)
      throw new Error("请输入有效日期，例如 2026-10-30 或 2026-10-30 23:30");
    const next = {
      ...req,
      sourceDate: req.date,
      sourceDueAt: req.dueAt,
      date: parsed.date,
      dueAt: parsed.dueAt,
      precision: parsed.dueAt ? "datetime" : "date",
      confidence: "explicit",
      version: req.version + 1,
      override: true,
    } as Requirement;
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE requirements SET payload=? WHERE id=?")
        .run(JSON.stringify(next), id);
      this.schedule(next);
    })();
  }
  notice(
    id: string,
    title: string,
    body: string,
    taskId?: string,
    requirementId?: string,
  ) {
    if (this.get("notices", id)) return;
    this.put("notices", id, {
      id,
      title,
      body,
      taskId,
      requirementId,
      createdAt: new Date().toISOString(),
      read: false,
      delivered: false,
      status: "pending",
    } satisfies Notice);
  }
  cancelPendingNotices(requirementId: string) {
    for (const n of this.all<Notice>("notices"))
      if (n.requirementId === requirementId && !n.delivered && !n.read)
        this.put("notices", n.id, { ...n, status: "superseded" });
  }
  due(now = Date.now()) {
    const { aliases } = this.presentation();
    this.suppressDuplicateNotices();
    const rows = this.db
      .prepare(
        "SELECT * FROM reminders WHERE status='pending' AND at<=? ORDER BY at",
      )
      .all(now) as { id: string; requirement_id: string; version: number }[];
    for (const row of rows) {
      const req = this.get<Requirement>("requirements", row.requirement_id);
      if (
        !req ||
        aliases.has(req.taskId) ||
        req.retired ||
        req.completed ||
        req.version !== row.version
      ) {
        this.db
          .prepare("UPDATE reminders SET status='cancelled' WHERE id=?")
          .run(row.id);
        continue;
      }
      const task = this.get<Task>("tasks", req.taskId);
      this.notice(
        row.id,
        `${req.phase === "late" ? "补交截止" : req.source === "teacher" ? "老师要求" : "系统截止"} · ${task?.title || "课程任务"}`,
        `${req.date}${req.dueAt ? " " + new Date(req.dueAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }) : "（未注明具体时刻）"}${req.confidence === "inferred" ? " · 年份由上下文推断，请核实" : ""}`,
        req.taskId,
        req.id,
      );
      this.db
        .prepare("UPDATE reminders SET status='recorded' WHERE id=?")
        .run(row.id);
    }
  }
  document(doc: DocumentRecord, requirements: Requirement[] = []) {
    this.db.transaction(() => {
      this.put("documents", doc.id, doc);
      for (const req of requirements) this.mergeRequirement(req);
    })();
  }
  readNotice(id: string) {
    const n = this.get<Notice>("notices", id);
    if (n) this.put("notices", id, { ...n, read: true });
  }
  delivered(id: string, status: string) {
    const n = this.get<Notice>("notices", id);
    if (n) this.put("notices", id, { ...n, delivered: true, status });
  }
  snooze(id: string) {
    const n = this.get<Notice>("notices", id);
    if (!n) return;
    this.readNotice(id);
    const later = Date.now() + 30 * 60000;
    if (n.requirementId) {
      const req = this.get<Requirement>("requirements", n.requirementId);
      if (req && !req.retired && !req.completed)
        this.db
          .prepare("INSERT OR IGNORE INTO reminders VALUES(?,?,?,?, 'pending')")
          .run(uid("snooze", id, String(later)), req.id, req.version, later);
    }
  }
  async backup(destination: string) {
    await this.db.backup(destination);
  }
  close() {
    if (this.db.open) this.db.close();
  }
}
