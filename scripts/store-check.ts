import { Store } from "../src/main/store";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTask } from "../src/collector/common";
import type { ScanResult } from "../src/shared/types";
const root = mkdtempSync(join(tmpdir(), "course-reminder-store-")),
  path = join(root, "test.sqlite");
let store = new Store(path);
const c = {
  id: "c",
  platform: "xjtu" as const,
  remoteId: "1",
  term: "2026",
  title: "线性代数",
  url: "https://lms.xjtu.edu.cn/course/1",
  active: true,
};
const t = makeTask(
  c,
  "1",
  "第三章作业",
  c.url,
  "未交",
  "assignment",
  "2026年10月27日交",
  "2026-10-30 23:59",
  true,
);
const scan: ScanResult = {
  platform: "xjtu",
  courses: [c],
  tasks: [t],
  coverage: [],
};
store.merge(scan);
store.merge(scan);
assert.equal(store.snapshot().tasks.length, 1);
assert.equal(store.snapshot().tasks[0].requirements.length, 2);
const teacher = t.requirements.find((r) => r.source === "teacher")!,
  system = t.requirements.find((r) => r.source === "system")!;
store.complete(teacher.id, true);
store.merge(scan);
assert.equal(
  store.snapshot().tasks[0].requirements.find((r) => r.id === teacher.id)
    ?.completed,
  true,
);
assert.equal(
  store.snapshot().tasks[0].requirements.find((r) => r.id === system.id)
    ?.completed,
  false,
);
const withoutTeacher = {
  ...t,
  requirements: [system],
  body: "老师已撤下原有日期，请留意后续通知。",
};
store.merge({ ...scan, tasks: [{ ...withoutTeacher, detailRead: false }] });
assert.equal(
  store.snapshot().tasks[0].requirements.length,
  2,
  "partial reads retain original teacher requirements",
);
store.merge({ ...scan, tasks: [withoutTeacher] });
assert.equal(
  store.snapshot().tasks[0].requirements.length,
  1,
  "a complete reread retires a removed body deadline",
);
assert.equal(store.get<any>("requirements", teacher.id)?.retired, true);
assert.equal(
  (
    store.db
      .prepare(
        "SELECT count(*) AS n FROM reminders WHERE requirement_id=? AND status='pending'",
      )
      .get(teacher.id) as { n: number }
  ).n,
  0,
);
store.merge(scan);
assert.equal(
  store.snapshot().tasks[0].requirements.length,
  2,
  "a reappearing deadline is restored",
);
store.merge({ ...scan, tasks: [{ ...t, submission: "submitted" }] });
assert.equal(
  store.snapshot().tasks[0].requirements.find((r) => r.id === system.id)
    ?.completed,
  true,
);
const completedVersion = store
  .snapshot()
  .tasks[0].requirements.find((r) => r.id === system.id)!.version;
store.merge({ ...scan, tasks: [{ ...t, submission: "needs_resubmit" }] });
const reactivated = store
  .snapshot()
  .tasks[0].requirements.find((r) => r.id === system.id)!;
assert.equal(reactivated.completed, false);
assert.ok(
  reactivated.version > completedVersion,
  "returned work gets a fresh reminder version",
);
assert.ok(
  store.snapshot().notices.some((n) => n.title === "课程任务需要重新提交"),
);
const lastFullSuccess = store
  .snapshot()
  .accounts.find((a) => a.platform === "xjtu")?.lastSuccess;
store.merge({
  ...scan,
  tasks: [],
  coverage: [
    {
      courseId: "c",
      section: "homework",
      status: "error",
      count: 0,
      message: "injected failure",
      at: new Date().toISOString(),
    },
  ],
});
assert.equal(store.snapshot().tasks.length, 1);
assert.equal(
  store.snapshot().accounts.find((a) => a.platform === "xjtu")?.lastSuccess,
  lastFullSuccess,
  "partial scans cannot advance complete-success time",
);
assert.equal(
  store.snapshot().accounts.find((a) => a.platform === "xjtu")?.state,
  "error",
);
store.correct(teacher.id, "2026-10-28");
store.merge(scan);
assert.equal(
  store.snapshot().tasks[0].requirements.find((r) => r.id === teacher.id)?.date,
  "2026-10-28",
);
store.saveSettings({ ...store.settings(), intervalMinutes: 15 });
await store.backup(join(root, "backup.sqlite"));
store.account("xjtu", { state: "checking" });
store.document({
  id: "interrupted-document",
  taskId: t.id,
  name: "中断测试.pdf",
  url: t.url,
  status: "pending",
  message: "等待解析",
  at: new Date().toISOString(),
});
store.close();
store = new Store(path);
assert.equal(
  store.snapshot().accounts.find((a) => a.platform === "xjtu")?.state,
  "error",
);
assert.equal(store.getMeta("nextAttempt:xjtu"), "1970-01-01T00:00:00.000Z");
assert.equal(
  store.snapshot().documents.find((d) => d.id === "interrupted-document")
    ?.status,
  "error",
);
assert.equal(store.settings().intervalMinutes, 15);
assert.equal(store.snapshot().tasks.length, 1);
store.close();
const restored = new Store(join(root, "backup.sqlite"));
assert.equal(
  restored.snapshot().tasks[0].requirements.find((r) => r.id === teacher.id)
    ?.date,
  "2026-10-28",
);
assert.equal(restored.db.pragma("integrity_check", { simple: true }), "ok");
restored.close();
const dedupStore = new Store(join(root, "dedup.sqlite"));
const mc = { ...c, id: "m", platform: "mooc" as const },
  sc = { ...c, id: "s", platform: "spoc" as const };
const mt = makeTask(
  mc,
  "q",
  "第三周测验",
  mc.url,
  "未交",
  "quiz",
  "",
  "2030-10-30 23:30",
  true,
);
const st = makeTask(
  sc,
  "q",
  "第三周测验",
  sc.url,
  "未交",
  "quiz",
  "",
  "2030-10-30 23:30",
  true,
);
dedupStore.merge({
  platform: "icourse",
  courses: [mc, sc],
  tasks: [mt, st],
  coverage: [],
});
assert.equal(dedupStore.snapshot().tasks.length, 1);
assert.equal(dedupStore.snapshot().tasks[0].courseId, "s");
assert.equal(
  dedupStore.all("tasks").length,
  2,
  "original MOOC source remains recoverable",
);
assert.equal(
  (
    dedupStore.db
      .prepare(
        "SELECT count(*) AS n FROM reminders WHERE requirement_id=? AND status='pending'",
      )
      .get(mt.requirements[0].id) as { n: number }
  ).n,
  0,
);
dedupStore.notice("old-mooc-notice", "重复通知", "测试", mt.id);
dedupStore.due();
assert.equal(
  dedupStore.get<any>("notices", "old-mooc-notice")?.status,
  "superseded",
);
assert.ok(
  !dedupStore.snapshot().notices.some((n) => n.id === "old-mooc-notice"),
);
const changed = makeTask(
  mc,
  "q",
  "第三周测验",
  mc.url,
  "未交",
  "quiz",
  "",
  "2031-10-30 23:30",
  true,
);
dedupStore.merge({
  platform: "icourse",
  courses: [mc],
  tasks: [changed],
  coverage: [],
});
assert.equal(
  dedupStore.snapshot().tasks.length,
  2,
  "different deadlines remain independent",
);
const lateTask = {
  ...st,
  id: "late-store",
  courseId: sc.id,
  requirements: [
    { ...st.requirements[0], id: "regular-store", taskId: "late-store" },
    {
      ...st.requirements[0],
      id: "late-store-r",
      taskId: "late-store",
      phase: "late" as const,
      date: "2030-11-02",
      dueAt: "2030-11-02T15:59:00Z",
    },
  ],
};
dedupStore.merge({
  platform: "icourse",
  courses: [sc],
  tasks: [lateTask],
  coverage: [],
});
assert.equal(
  dedupStore.snapshot().tasks.find((t) => t.id === "late-store")!.requirements
    .length,
  2,
);
assert.ok(
  (
    dedupStore.db
      .prepare(
        "SELECT count(*) AS n FROM reminders WHERE requirement_id=? AND status='pending'",
      )
      .get("late-store-r") as { n: number }
  ).n > 0,
  "supplemental deadline schedules reminders independently",
);
dedupStore.merge({
  platform: "icourse",
  courses: [sc],
  tasks: [{ ...lateTask, submission: "submitted" }],
  coverage: [],
});
assert.ok(
  dedupStore
    .snapshot()
    .tasks.find((t) => t.id === "late-store")!
    .requirements.every((r) => r.completed),
);
assert.equal(
  (
    dedupStore.db
      .prepare(
        "SELECT count(*) AS n FROM reminders WHERE requirement_id=? AND status='pending'",
      )
      .get("late-store-r") as { n: number }
  ).n,
  0,
  "submitted task cancels supplemental reminders",
);
dedupStore.close();
console.log(
  "PASS SQLite dedup, independent completion, partial-failure preservation, manual override, restart, backup and integrity",
);
