import { createHash } from "node:crypto";
import type { Requirement } from "../shared/types";
export const uid = (...parts: string[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
export const todayShanghai = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export function parseDate(
  value: string,
  reference = new Date(),
): { date: string; dueAt?: string; inferred: boolean } | null {
  const s = value.normalize("NFKC");
  const m = s.match(
    /(?:(\d{4})\s*[年.\/-]\s*)?(\d{1,2})\s*[月.\/-]\s*(\d{1,2})(?:\s*日)?(?:\s*(?:[T日]|晚上|下午|上午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})(?::\d{2})?)?/,
  );
  if (!m) return null;
  let year = m[1] ? Number(m[1]) : Number(todayShanghai(reference).slice(0, 4));
  const month = Number(m[2]),
    day = Number(m[3]),
    hour = Number(m[4] || 0),
    minute = Number(m[5] || 0);
  if (!m[1]) {
    const referenceDay = Date.parse(`${todayShanghai(reference)}T00:00:00Z`);
    year = [year - 1, year, year + 1].sort(
      (a, b) =>
        Math.abs(Date.UTC(a, month - 1, day) - referenceDay) -
        Math.abs(Date.UTC(b, month - 1, day) - referenceDay),
    )[0];
  }
  if (
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const test = new Date(Date.UTC(year, month - 1, day));
  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() !== month - 1 ||
    test.getUTCDate() !== day
  )
    return null;
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    date,
    dueAt:
      m[4] !== undefined
        ? new Date(
            `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`,
          ).toISOString()
        : undefined,
    inferred: !m[1],
  };
}
export function systemRequirement(
  taskId: string,
  text: string,
  url: string,
): Requirement | null {
  const parsed = parseDate(text);
  return parsed
    ? {
        id: uid(taskId, "system"),
        taskId,
        source: "system",
        precision: parsed.dueAt ? "datetime" : "date",
        date: parsed.date,
        dueAt: parsed.dueAt,
        original: text.trim().slice(0, 500),
        evidenceUrl: url,
        confidence: parsed.inferred ? "inferred" : "explicit",
        completed: false,
        version: 1,
      }
    : null;
}
export function teacherRequirements(
  taskId: string,
  text: string,
  url: string,
  reference = new Date(),
  ocr = false,
): Requirement[] {
  const normalized = text.normalize("NFKC");
  const dates = [
    ...normalized.matchAll(
      /(?:(?:20\d{2})\s*[年.\/-]\s*)?\d{1,2}\s*[月.\/-]\s*\d{1,2}(?:\s*日)?(?:\s*\d{1,2}\s*[:：]\s*\d{2})?/g,
    ),
  ];
  const out: Requirement[] = [];
  for (const match of dates) {
    const at = match.index!,
      before = normalized.slice(Math.max(0, at - 35), at),
      after = normalized.slice(at + match[0].length, at + match[0].length + 35);
    const context = before + match[0] + after;
    // Textbooks use 3.1(A), 3.2(1) etc. These are exercise identifiers, not dates.
    if (
      /^\d{1,2}[.\/-]\d{1,2}$/.test(match[0]) &&
      (/^\s*[（(]/.test(after) || /(?:习题|题号|章节|第)[^\n]*$/.test(before))
    )
      continue;
    if (/(发布|发表|更新|上传)(时间|于)?\s*[:：]?\s*$/.test(before)) continue;
    if (
      !/截止|提交|交作业|交[纸稿到给]|[日号]交|完成|考试|测验|互评|上交|交\s|交$/.test(
        context,
      ) &&
      !/^\s*(?:交(?=$|\s|作业|报告|论文|材料|纸|稿|到|给|表|[，。；])|前(?=$|\s|完成|提交|上交|交|[，。；]))/.test(
        after,
      )
    )
      continue;
    const parsed = parseDate(match[0], reference);
    if (!parsed) continue;
    if (out.some((x) => x.date === parsed.date && x.dueAt === parsed.dueAt))
      continue;
    out.push({
      id: uid(taskId, "teacher", url, String(out.length)),
      taskId,
      source: "teacher",
      precision: parsed.dueAt ? "datetime" : "date",
      date: parsed.date,
      dueAt: parsed.dueAt,
      original: context.trim(),
      evidenceUrl: url,
      confidence: ocr ? "review" : parsed.inferred ? "inferred" : "explicit",
      completed: false,
      version: 1,
    });
  }
  return out;
}
export function reminderSlots(req: Requirement): number[] {
  if (req.confidence === "review") return [];
  if (req.dueAt) {
    const due = Date.parse(req.dueAt);
    return [due - 3 * 86400000, due - 86400000, due - 3 * 3600000];
  }
  return [
    Date.parse(`${req.date}T20:00:00+08:00`) - 86400000,
    Date.parse(`${req.date}T09:00:00+08:00`),
  ];
}
export function isOverdue(req: Requirement, now = new Date()): boolean {
  return (
    !req.completed &&
    (req.dueAt
      ? Date.parse(req.dueAt) < now.getTime()
      : req.date < todayShanghai(now))
  );
}
export function classifySubmission(text: string) {
  if (/打回|退回|需重交|重新提交作业/.test(text))
    return "needs_resubmit" as const;
  if (
    /有效提交次数\s*[:：]?\s*[1-9]\d*\s*\/|有效提交记录[\s\S]*20\d{2}|\b已交\b|已提交|提交成功/.test(
      text,
    ) ||
    /已交/.test(text)
  )
    return "submitted" as const;
  if (/未交|未提交|待提交|有效提交次数\s*[:：]?\s*0\s*\//.test(text))
    return "not_submitted" as const;
  if (/未开放|尚未开始/.test(text)) return "not_open" as const;
  return "unknown" as const;
}
