import { it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { extractBuffer } from "../../src/extraction/documents";
it("extracts schedule dates and their task context from an actual XLSX buffer", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("进度安排");
  sheet.addRow(["任务", "老师要求日期"]);
  sheet.addRow(["提交课程报告", "2026年10月30日"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await extractBuffer(
    buffer,
    ".xlsx",
    mkdtempSync(join(tmpdir(), "reminder-test-")),
  );
  expect(result.text).toContain("提交课程报告");
  expect(result.text).toContain("2026年10月30日");
  expect(result.partial).toBe(false);
});
it("rejects unsupported legacy document formats instead of reporting empty success", async () => {
  await expect(
    extractBuffer(Buffer.from("old word"), ".doc", tmpdir()),
  ).rejects.toThrow("暂不支持");
});
