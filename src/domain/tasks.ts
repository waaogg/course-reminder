import type { Course, Requirement, Task } from "../shared/types";
const day = (now: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export function isRequirementOverdue(r: Requirement, now = Date.now()) {
  return (
    !r.retired &&
    !r.completed &&
    (r.dueAt ? Date.parse(r.dueAt) < now : r.date < day(now))
  );
}
export function taskFullyCompleted(t: Task) {
  const rs = t.requirements.filter((r) => !r.retired);
  return rs.length
    ? rs.every((r) => r.completed)
    : t.submission === "submitted";
}
export function taskSubmittedOrCompleted(t: Task) {
  return t.submission === "submitted" || taskFullyCompleted(t);
}
export function needsTeacherAction(t: Task) {
  return t.requirements.some(
    (r) => r.source === "teacher" && !r.retired && !r.completed,
  );
}
export function isOverdueUnsubmitted(t: Task, now = Date.now()) {
  return (
    !taskSubmittedOrCompleted(t) &&
    ["not_submitted", "needs_resubmit"].includes(t.submission) &&
    t.requirements.some(
      (r) => r.source === "system" && !r.phase && isRequirementOverdue(r, now),
    )
  );
}
export function lateSubmissionLabel(t: Task, now = Date.now()) {
  const late = t.requirements.find((r) => r.phase === "late" && !r.retired);
  if (late && isRequirementOverdue(late, now)) return "补交期限已过";
  if (t.lateSubmission?.state === "closed") return "平台明确不可补交";
  if (t.lateSubmission?.state === "allowed") return "逾期可补交";
  return t.detailRead ? "无补交说明" : "补交信息尚未读取";
}
export function taskSubmissionLabel(t: Task, now = Date.now()) {
  if (t.submission !== "submitted" && taskFullyCompleted(t))
    return "已完成（本地标记）";
  if (isOverdueUnsubmitted(t, now))
    return lateSubmissionLabel(t, now) === "逾期可补交"
      ? "逾期可补交"
      : "逾期未提交 · " + lateSubmissionLabel(t, now);
  if (t.submission === "submitted" && needsTeacherAction(t))
    return "已提交 · 老师要求待处理";
  if (t.submission === "unknown") return t.detailRead ? (t.kind === "announcement" ? "公告" : "无提交状态") : "尚未读取";
  return {
    unknown: "待核实",
    not_submitted: "未提交",
    submitted: "已提交",
    needs_resubmit: "需重新提交",
    not_open: "尚未开放",
  }[t.submission];
}
const normalized = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s（()）]/g, "");
function signature(t: Task, source: "system" | "teacher" = "system") {
  return t.requirements
    .filter((r) => r.source === source && !r.retired)
    .map((r) => `${r.date}|${r.dueAt || ""}`)
    .sort()
    .join(";");
}
function termCompatible(a: Course, b: Course) {
  const year = (s: string) =>
    s.match(/20\d{2}\s*[-—–]\s*20\d{2}/)?.[0].replace(/\s/g, "");
  const x = year(a.term),
    y = year(b.term);
  const semester = (s: string) =>
    s
      .match(/第([12一二])学期/)?.[1]
      .replace("一", "1")
      .replace("二", "2");
  const ax = semester(a.term),
    by = semester(b.term);
  return (!x || !y || x === y) && (!ax || !by || ax === by);
}
export function preferSpoc(tasks: Task[], courses: Course[]) {
  const byCourse = new Map(courses.map((c) => [c.id, c])),
    aliases = new Map<string, string>();
  const spoc = tasks.filter(
    (t) =>
      byCourse.get(t.courseId)?.platform === "spoc" &&
      byCourse.get(t.courseId)?.active,
  );
  for (const t of tasks) {
    const c = byCourse.get(t.courseId);
    if (c?.platform !== "mooc" || t.kind === "announcement") continue;
    const sig = signature(t);
    if (!sig) continue;
    const matches = spoc.filter((s) => {
      const other = byCourse.get(s.courseId)!;
      return (
        normalized(other.title) === normalized(c.title) &&
        termCompatible(c, other) &&
        s.kind === t.kind &&
        normalized(s.title) === normalized(t.title) &&
        signature(s) === sig &&
        signature(s, "teacher") === signature(t, "teacher")
      );
    });
    if (matches.length === 1) aliases.set(t.id, matches[0].id);
  }
  const primary = tasks
    .filter((t) => !aliases.has(t.id))
    .map((t) => ({
      ...t,
      alternateSources: tasks
        .filter((s) => aliases.get(s.id) === t.id)
        .map((s) => ({
          taskId: s.id,
          courseId: s.courseId,
          url: s.url,
          submission: s.submission,
          locallyCompleted: taskFullyCompleted(s),
        })),
    }));
  const candidates = new Map<string, Set<string>>();
  for (const [from, to] of aliases) {
    const a = tasks.find((t) => t.id === from)!,
      b = tasks.find((t) => t.id === to)!;
    const set = candidates.get(a.courseId) || new Set<string>();
    set.add(b.courseId);
    candidates.set(a.courseId, set);
  }
  const courseAliases = new Map(
    [...candidates]
      .filter(([, ids]) => ids.size === 1)
      .map(([id, ids]) => [id, [...ids][0]]),
  );
  return { tasks: primary, aliases, courseAliases };
}
