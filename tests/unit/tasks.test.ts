import { describe, it, expect } from "vitest";
import {
  preferSpoc,
  isOverdueUnsubmitted,
  taskSubmittedOrCompleted,
  needsTeacherAction,
  taskSubmissionLabel,
} from "../../src/domain/tasks";
import type { Course, Task, Requirement } from "../../src/shared/types";
const now = Date.parse("2026-10-27T12:00:00+08:00");
const req: Requirement = {
  id: "r",
  taskId: "t",
  source: "system",
  date: "2026-10-26",
  precision: "date",
  original: "截止10月26日",
  evidenceUrl: "https://www.icourse163.org/",
  confidence: "explicit",
  completed: false,
  version: 1,
};
const task: Task = {
  id: "t",
  courseId: "m",
  title: "第三周测验",
  kind: "quiz",
  url: "https://www.icourse163.org/",
  submission: "not_submitted",
  submissionEvidence: "未提交",
  body: "",
  requirements: [req],
  attachments: [],
  detailRead: true,
  updatedAt: new Date(now).toISOString(),
};
const courses: Course[] = [
  {
    id: "m",
    remoteId: "1",
    platform: "mooc",
    title: "高等数学（一）",
    term: "opaque1",
    url: task.url,
    active: true,
  },
  {
    id: "s",
    remoteId: "2",
    platform: "spoc",
    title: "高等数学（一）",
    term: "opaque2",
    url: task.url,
    active: true,
  },
];
describe("completion and overdue submission remain separate", () => {
  it("keeps submitted work out of overdue-unsubmitted while retaining teacher actions", () => {
    const t = {
      ...task,
      submission: "submitted" as const,
      requirements: [
        { ...req, completed: true },
        { ...req, id: "teacher", source: "teacher" as const },
      ],
    };
    expect(taskSubmittedOrCompleted(t)).toBe(true);
    expect(isOverdueUnsubmitted(t, now)).toBe(false);
    expect(needsTeacherAction(t)).toBe(true);
    expect(taskSubmissionLabel(t, now)).toContain("老师要求待处理");
  });
  it("requires positive unsubmitted evidence and a system deadline", () => {
    expect(isOverdueUnsubmitted(task, now)).toBe(true);
    expect(isOverdueUnsubmitted({ ...task, submission: "unknown" }, now)).toBe(
      false,
    );
    expect(taskSubmissionLabel({ ...task, submission: "unknown" }, now)).toBe(
      "无提交状态",
    );
    expect(taskSubmissionLabel({...task,submission:"unknown",detailRead:false},now)).toBe("尚未读取");
    expect(
      isOverdueUnsubmitted(
        { ...task, requirements: [{ ...req, source: "teacher" }] },
        now,
      ),
    ).toBe(false);
  });
  it("respects date-only precision and explicit manual completion", () => {
    expect(
      isOverdueUnsubmitted(
        { ...task, requirements: [{ ...req, date: "2026-10-27" }] },
        now,
      ),
    ).toBe(false);
    const t = { ...task, requirements: [{ ...req, completed: true }] };
    expect(taskSubmittedOrCompleted(t)).toBe(true);
    expect(isOverdueUnsubmitted(t, now)).toBe(false);
  });
});
describe("SPOC preference", () => {
  const spoc = {
    ...task,
    id: "s-task",
    courseId: "s",
    submission: "unknown" as const,
  };
  it("retains unique teacher requirements and refuses inactive or different-semester SPOC matches", () => {
    expect(
      preferSpoc(
        [
          task,
          {
            ...spoc,
            requirements: [req, { ...req, id: "teacher", source: "teacher" }],
          },
        ],
        courses,
      ).tasks,
    ).toHaveLength(2);
    expect(
      preferSpoc(
        [task, spoc],
        courses.map((c) => (c.id === "s" ? { ...c, active: false } : c)),
      ).tasks,
    ).toHaveLength(2);
    expect(
      preferSpoc(
        [task, spoc],
        courses.map((c) => ({
          ...c,
          term: c.id === "m" ? "2026-2027第1学期" : "2026-2027第2学期",
        })),
      ).tasks,
    ).toHaveLength(2);
  });
  it("prefers SPOC and retains the MOOC source without inventing SPOC submission", () => {
    const result = preferSpoc([task, spoc], courses);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe("s-task");
    expect(result.tasks[0].submission).toBe("unknown");
    expect(result.tasks[0].alternateSources?.[0].taskId).toBe("t");
  });
  it("does not merge different dates, unknown deadlines, stages, ambiguous matches or unrelated courses", () => {
    for (const s of [
      { ...spoc, requirements: [{ ...req, date: "2027-10-26" }] },
      { ...spoc, requirements: [] },
      { ...spoc, kind: "peer_review" as const },
    ])
      expect(preferSpoc([task, s], courses).tasks).toHaveLength(2);
    expect(
      preferSpoc([task, spoc, { ...spoc, id: "other" }], courses).tasks,
    ).toHaveLength(3);
    expect(
      preferSpoc(
        [task, spoc],
        courses.map((c) => (c.id === "s" ? { ...c, title: "另一个课程" } : c)),
      ).tasks,
    ).toHaveLength(2);
  });
  it("does not collapse announcements or separate academic years", () => {
    expect(
      preferSpoc(
        [
          { ...task, kind: "announcement" },
          { ...spoc, kind: "announcement" },
        ],
        courses,
      ).tasks,
    ).toHaveLength(2);
    expect(
      preferSpoc(
        [task, spoc],
        courses.map((c) => ({
          ...c,
          term: c.id === "m" ? "2025-2026第1学期" : "2026-2027第1学期",
        })),
      ).tasks,
    ).toHaveLength(2);
  });
});
