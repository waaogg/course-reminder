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
