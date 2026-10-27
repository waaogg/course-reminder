import { describe, expect, it } from "vitest";
import {
  parseDate,
  teacherRequirements,
  systemRequirement,
  classifySubmission,
  reminderSlots,
  isOverdue,
  todayShanghai,
} from "../../src/domain/time";
import { allowedExternal, redactError } from "../../src/domain/security";
describe("independent date semantics", () => {
  it("preserves Shanghai 23:30 without substituting the end of day", () => {
    expect(parseDate("截止时间：2026/10/31 23:30")?.dueAt).toBe(
      "2026-10-31T15:30:00.000Z",
    );
  });
  it("keeps date-only precision and infers year visibly", () => {
    expect(parseDate("10月27日交", new Date("2026-10-27T01:00:00Z"))).toEqual({
      date: "2026-10-27",
      dueAt: undefined,
      inferred: true,
    });
  });
  it("infers the adjacent academic year for January rather than last January", () => {
    expect(parseDate("1月3日交", new Date("2026-12-20T01:00:00Z"))?.date).toBe(
      "2027-01-03",
    );
  });
  it("rejects invalid dates and leap-day mistakes", () => {
    expect(parseDate("2026-02-29 23:30")).toBeNull();
    expect(parseDate("2028-02-29")).not.toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("2026-10-31 25:00")).toBeNull();
  });
  it("extracts the real teacher date, never exercise identifiers", () => {
    const body =
      "第3章作业10月27日交\n\n习题3.1(A)8,9,10,11,12,16,18\n习题3.2(A)1,3,4,7,8,11,12,17,18\n习题3.3(A)1(2)(4)(6)";
    const rs = teacherRequirements(
      "task",
      body,
      "https://lms.xjtu.edu.cn/course/1",
      new Date("2026-10-27T00:00:00Z"),
    );
    expect(rs.map((r) => r.date)).toEqual(["2026-10-27"]);
    expect(rs[0].dueAt).toBeUndefined();
  });
  it("does not turn publication dates into deadlines", () => {
    expect(
      teacherRequirements(
        "a",
        "公告发布时间：2026年10月1日\n课程作业更新",
        "https://lms.xjtu.edu.cn",
      ),
    ).toHaveLength(0);
  });
  it("uses separate stable source IDs and reminder plans", () => {
    const s = systemRequirement(
      "t",
      "2026-10-30 23:59",
      "https://lms.xjtu.edu.cn",
    )!;
    const t = teacherRequirements(
      "t",
      "10月27日交",
      "https://lms.xjtu.edu.cn",
      new Date("2026-10-27"),
    )[0];
    expect(s.id).not.toBe(t.id);
    expect(s.date).toBe("2026-10-30");
    expect(t.date).toBe("2026-10-27");
    expect(reminderSlots(t)).toEqual([
      Date.parse("2026-10-26T20:00:00+08:00"),
      Date.parse("2026-10-27T09:00:00+08:00"),
    ]);
  });
  it("never treats date-only today as a precise midnight cutoff", () => {
    const req = teacherRequirements(
      "t",
      "10月27日交",
      "https://lms.xjtu.edu.cn",
      new Date("2026-10-27"),
    )[0];
    expect(isOverdue(req, new Date("2026-10-27T15:59:00Z"))).toBe(false);
    expect(isOverdue(req, new Date("2026-10-27T16:00:00Z"))).toBe(true);
    expect(todayShanghai(new Date("2026-10-26T17:00:00Z"))).toBe("2026-10-27");
  });
  it("requires confirmation for OCR and does not schedule it as certain", () => {
    const r = teacherRequirements(
      "t",
      "请于2026年10月30日提交",
      "https://lms.xjtu.edu.cn",
      new Date(),
      true,
    )[0];
    expect(r.confidence).toBe("review");
    expect(reminderSlots(r)).toEqual([]);
  });
});
it("does not interpret a publication timestamp followed by 交大 as a submission date", () => {
  const text =
    "课程组\n\n2026/10/08 13:27\n交大专属课程开课啦！\n亲爱的同学们，欢迎参与课程学习。";
  expect(
    teacherRequirements("announcement", text, "https://www.icourse163.org/"),
  ).toEqual([]);
  expect(
    teacherRequirements(
      "assignment",
      "请于2026/10/27交报告",
      "https://lms.xjtu.edu.cn/course/1",
    ),
  ).toHaveLength(1);
});
describe("submission evidence", () => {
  it.each([
    ["未评分", "unknown"],
    ["成绩已锁定", "unknown"],
    ["0分", "unknown"],
    ["有效提交次数 2 / 3", "submitted"],
    ["未交", "not_submitted"],
    ["已交", "submitted"],
    ["已提交待评分", "submitted"],
    ["打回重做", "needs_resubmit"],
    ["有效提交次数 0/3", "not_submitted"],
  ])("%s is %s", (text, status) =>
    expect(classifySubmission(text)).toBe(status),
  );
});
describe("external inputs", () => {
  it("allows platform links but rejects arbitrary schemes/hosts", () => {
    expect(allowedExternal("https://lms.xjtu.edu.cn/course/1")).toBe(true);
    expect(allowedExternal("https://www.icourse163.org/")).toBe(true);
    for (const u of [
      "javascript:alert(1)",
      "file:///C:/Windows",
      "https://evil-icourse163.org/",
      "https://user:password@lms.xjtu.edu.cn/",
    ])
      expect(allowedExternal(u)).toBe(false);
  });
  it("removes token-bearing query strings from error messages", () => {
    expect(
      redactError(new Error("Failed https://example.org/file?token=secret")),
    ).not.toContain("secret");
  });
});
