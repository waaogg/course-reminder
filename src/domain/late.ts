import type { Task, Requirement } from "../shared/types";
import { systemRequirement, uid } from "./time";
/** Only explicit policy or a required-resubmission status plus an available action is positive evidence. */
export function lateSubmission(
  text: string,
  url: string,
  observedAt: string,
): NonNullable<Task["lateSubmission"]> {
  const lines = text
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const relevant = lines.filter((s) => /补交|迟交|晚交|延迟提交/.test(s));
  const closed = relevant.some((s) =>
    /不允许|不接受|禁止|不可|不能|已关闭|已结束|不支持/.test(s),
  );
  const allowed =
    relevant.some((s) =>
      /允许补交|可以补交|可补交|接受补交|支持补交|补交开放/.test(s),
    ) ||
    (lines.includes("要求补交") && lines.includes("去交作业"));
  return {
    state: closed ? "closed" : allowed ? "allowed" : "unknown",
    evidence: relevant.join("\n").slice(0, 800),
    url,
    observedAt,
  };
}
export function lateRequirement(
  taskId: string,
  text: string,
  url: string,
): Requirement | null {
  const value = text.match(
    /(?:补交|迟交|晚交)(?:截止|结束)(?:时间)?\s*[:：]?\s*(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?(?:\s+\d{1,2}:\d{2})?)/,
  )?.[0];
  if (!value) return null;
  const r = systemRequirement(taskId, value, url);
  return r ? { ...r, id: uid(taskId, "late"), phase: "late" } : null;
}
export function regularDeadline(text: string): string {
  const ordinary = text
    .normalize("NFKC")
    .split(/\n/)
    // Keep a boundary: removing a supplemental label could attach its date to
    // an empty ordinary-deadline label on the preceding line.
    .map((line) => /补交|迟交|晚交/.test(line) ? "\uFFFC" : line)
    .join("\n");
  const date = String.raw`20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?`;
  // Start/publication times and arbitrary dates are never deadline evidence.
  const explicit = ordinary.match(new RegExp(
    String.raw`(?:结束于|结束时间|结束日期|截止时间|截止日期|截止于|截止)\s*[:：]?\s*(${date})`,
  ));
  if (explicit) return explicit[1];
  // Some detail pages expose only an activity interval. Its right endpoint is
  // the deadline; both endpoints and a range separator must actually exist.
  return ordinary.match(new RegExp(
    String.raw`(?:活动时间|作业时间|测试时间|考试时间)\s*[:：]?\s*${date}\s*(?:至|到|~|～|—|–|－|-|→)\s*(${date})`,
  ))?.[1] || "";
}
