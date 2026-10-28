import { it, expect } from "vitest";
import {
  lateSubmission,
  lateRequirement,
  regularDeadline,
} from "../../src/domain/late";
import { lateSubmissionLabel } from "../../src/domain/tasks";
import type { Task } from "../../src/shared/types";
const url = "https://lms.xjtu.edu.cn/",
  at = "2026-10-27T08:00:00Z";
it("requires explicit policy, not a bare or historical label", () => {
  expect(lateSubmission("补交", url, at).state).toBe("unknown");
  expect(lateSubmission("已补交", url, at).state).toBe("unknown");
  expect(lateSubmission("要求补交\n去交作业", url, at).state).toBe("allowed");
  expect(lateSubmission("允许补交", url, at).state).toBe("allowed");
  expect(lateSubmission("不允许补交", url, at).state).toBe("closed");
  expect(lateSubmission("补交已结束", url, at).state).toBe("closed");
});
it("keeps original and supplemental deadlines independently identifiable", () => {
  const text = "补交截止时间：2026-10-30 23:59\n截止时间：2026-10-26 23:59";
  expect(regularDeadline(text)).toBe("2026-10-26 23:59");
  const r = lateRequirement("t", text, url)!;
  expect(r.phase).toBe("late");
  expect(r.date).toBe("2026-10-30");
  expect(regularDeadline("补交截止时间：2026-10-30 23:59")).toBe("");
  const t = {
    requirements: [r],
    lateSubmission: lateSubmission("允许补交", url, at),
  } as Task;
  expect(lateSubmissionLabel(t, Date.parse(at))).toBe("逾期可补交");
  expect(lateSubmissionLabel(t, Date.parse("2026-11-01"))).toBe("补交期限已过");
});

it("never substitutes a start time, publication time or an unlabelled date", () => {
  expect(regularDeadline("大学化学第四章作业\n开始时间：2026-10-28 10:00")).toBe("");
  expect(regularDeadline("发布时间：2026-10-28 10:00")).toBe("");
  expect(regularDeadline("2026-10-28 10:00\n未开放")).toBe("");
});

it("selects the explicit ending even when the start appears first", () => {
  expect(regularDeadline("开始时间：2026-10-28 10:00\n截止时间：2026-11-05 23:59"))
    .toBe("2026-11-05 23:59");
  expect(regularDeadline("开始时间：2026-10-28 10:00\n结束时间\n2026-11-05 23:59"))
    .toBe("2026-11-05 23:59");
});

it("uses only the right endpoint of a complete labelled activity interval", () => {
  for (const separator of ["至", "~", "—", " - ", "\n至\n"]) {
    expect(regularDeadline(`活动时间\n2026-10-28 10:00${separator}2026-11-05 23:59`))
      .toBe("2026-11-05 23:59");
  }
  expect(regularDeadline("活动时间：2026-10-28 10:00")).toBe("");
  expect(regularDeadline("活动时间\n2026-10-28\n10:00\n至\n2026-11-05\n23:59"))
    .toBe("2026-11-05\n23:59");
  expect(regularDeadline("开始时间：2026-10-28 10:00 至 2026-11-05 23:59")).toBe("");
});

it("supports Chinese dates and keeps date-only deadlines without invented hours", () => {
  expect(regularDeadline("截止日期：2026年11月5日")).toBe("2026年11月5日");
  expect(regularDeadline("结束于：2026/11/05 23：30")).toBe("2026/11/05 23:30");
});

it("does not relabel a supplemental date as an empty regular deadline", () => {
  expect(regularDeadline("截止时间\n补交截止时间\n2026-11-05 23:59")).toBe("");
  expect(regularDeadline("补交截止时间：2026-11-08 23:59\n活动时间：2026-10-28 10:00～2026-11-05 23:59"))
    .toBe("2026-11-05 23:59");
});
