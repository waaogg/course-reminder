import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { makeTask } from "../src/collector/common";
import type { Course, ScanResult } from "../src/shared/types";
const root = resolve(".test-data", `task-views-${Date.now()}`);
mkdirSync(root, { recursive: true });
const base: Course = {
  id: "x",
  remoteId: "x",
  platform: "xjtu",
  title: "线性代数",
  term: "2026-2027",
  url: "https://lms.xjtu.edu.cn/course/1",
  active: true,
};
const m: Course = {
  ...base,
  id: "m",
  platform: "mooc",
  title: "高等数学",
  term: "opaque-m",
  url: "https://www.icourse163.org/",
};
const s: Course = { ...m, id: "s", platform: "spoc", term: "opaque-s" };
const task = (
  id: string,
  title: string,
  state: string,
  body = "",
  future = false,
  c = base,
) =>
  makeTask(
    c,
    id,
    title,
    c.url,
    state,
    "quiz",
    body,
    future ? "2030-10-30 23:30" : "2000-10-26 23:30",
    true,
  );
const fixture: ScanResult = {
  platform: "icourse",
  courses: [base, m, s],
  coverage: [],
  tasks: [
    task("done", "已交测试", "已提交"),
    task("late", "漏交测试", "未交"),
    task("teacher", "线下要求测试", "已提交", "请在2026年10月26日交报告"),
    task("unknown", "锁分测试", "成绩已锁定"),
    task("dup", "重复测验", "未交", "", true, m),
    task("dup", "重复测验", "未交", "", true, s),
  ],
};
fixture.tasks[1].lateSubmission = {
  state: "allowed",
  evidence: "允许补交",
  observedAt: new Date().toISOString(),
  url: base.url,
};
fixture.tasks[1].requirements.push({
  ...fixture.tasks[1].requirements[0],
  id: "late-extra",
  phase: "late",
  date: "2030-12-30",
  dueAt: "2030-12-30T15:59:00Z",
  original: "补交截止时间2030-12-30 23:59",
});
const path = join(root, "fixture.json");
writeFileSync(path, JSON.stringify(fixture));
const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    REMINDER_DATA_DIR: root,
    REMINDER_FIXTURE: path,
  }).filter((x): x is [string, string] => typeof x[1] === "string"),
);
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  ...(process.argv.includes("--packaged")
    ? {
        executablePath: resolve("release/win-unpacked/课期.exe"),
        args: ["--smoke"],
      }
    : { args: [".", "--smoke"] }),
  env,
});
try {
  const page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  const snapshot = await page.evaluate(() => window.reminder.snapshot());
  assert.equal(snapshot.courses.filter((c) => !c.preferredCourseId).length, 2);
  assert.equal(snapshot.tasks.length, 5);
  await page.getByRole("tab", { name: "全部", exact: true }).click();
  assert.equal(
    await page.locator(".task-card h2").filter({ hasText: "重复测验" }).count(),
    1,
  );
  await page.getByRole("tab", { name: "已完成", exact: true }).click();
  assert.equal(await page.locator(".task-card h2").count(), 2);
  assert.equal(
    await page.getByRole("heading", { name: "漏交测试", exact: true }).count(),
    0,
  );
  await page.getByRole("tab", { name: "逾期未提交", exact: true }).click();
  assert.equal(await page.locator(".task-card h2").count(), 1);
  await page.getByRole("heading", { name: "漏交测试", exact: true }).waitFor();
  await page.getByText("逾期可补交", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "漏交测试", exact: true }).click();
  await page.getByRole("heading", { name: "补交情况", exact: true }).waitFor();
  await page.getByText("补交截止 ·", { exact: false }).waitFor();
  await page.screenshot({
    path: ".runtime/screenshots/late-submission-1.0.1.png",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "老师待办", exact: true }).click();
  await page
    .getByRole("heading", { name: "线下要求测试", exact: true })
    .waitFor();
  assert.equal(await page.locator(".task-card h2").count(), 1);
  await page.getByRole("tab", { name: "待核对", exact: true }).click();
  assert.equal(await page.getByRole("heading", { name: "锁分测试", exact: true }).count(),0);
  await page.getByRole("tab", { name: "全部", exact: true }).click();
  await page.getByRole("heading", { name: "重复测验", exact: true }).click();
  await page
    .getByRole("heading", { name: "重复来源（优先保留SPOC）", exact: true })
    .waitFor();
  await page.screenshot({ path: ".runtime/screenshots/task-views-1.0.1.png" });
  console.log(
    "PASS completed / overdue-unsubmitted / teacher actions / unknown status UI separation, SPOC preference and preserved alternate source.",
  );
} finally {
  await application.close();
}
