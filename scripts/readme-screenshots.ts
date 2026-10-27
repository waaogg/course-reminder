import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { makeTask } from "../src/collector/common";
import type { Course, ScanResult } from "../src/shared/types";
const root = resolve(".test-data", `readme-${Date.now()}`),
  images = resolve("docs/images");
mkdirSync(root, { recursive: true });
mkdirSync(images, { recursive: true });
const c: Course = {
  id: "demo-math",
  remoteId: "demo",
  platform: "xjtu",
  title: "线性代数 · 演示课程",
  term: "2026-2027第1学期",
  url: "https://lms.xjtu.edu.cn/",
  active: true,
};
const m: Course = {
  ...c,
  id: "demo-mooc",
  platform: "mooc",
  title: "高等数学 · 演示课程",
  url: "https://www.icourse163.org/",
};
const s: Course = { ...m, id: "demo-spoc", platform: "spoc" };
const assignment = makeTask(
  c,
  "a",
  "第三章作业：向量与线性方程组",
  c.url,
  "未提交",
  "assignment",
  "请在2026年10月28日交课堂报告。平台作业上传截止时间单独列出，请分别完成。",
  "2026-10-30 23:59",
  true,
);
const late = makeTask(
  c,
  "b",
  "第二章练习：补交窗口开放",
  c.url,
  "要求补交",
  "assignment",
  "演示数据：本次作业允许补交，请在补交窗口关闭前上传。",
  "2026-10-25 23:59",
  true,
);
late.submission = "needs_resubmit";
late.lateSubmission = {
  state: "allowed",
  evidence: "允许补交；补交截止时间：2026-10-31 23:59",
  observedAt: new Date().toISOString(),
  url: c.url,
};
late.requirements.push({
  ...late.requirements[0],
  id: "demo-late-r",
  phase: "late",
  date: "2026-10-31",
  dueAt: "2026-10-31T15:59:00Z",
  original: "补交截止时间：2026-10-31 23:59",
});
const duplicate = (course: Course) =>
  makeTask(
    course,
    "q",
    "第四周测验",
    course.url,
    "未提交",
    "quiz",
    "演示测验，同一任务的MOOC与SPOC来源。",
    "2026-11-02 23:30",
    true,
  );
const fixture: ScanResult = {
  platform: "icourse",
  courses: [c, m, s],
  coverage: [c, m, s].map((course) => ({
    courseId: course.id,
    section: "演示数据",
    status: "success",
    count: 2,
    message: "",
    at: new Date().toISOString(),
  })),
  tasks: [
    assignment,
    late,
    duplicate(m),
    duplicate(s),
    makeTask(
      c,
      "done",
      "第一章作业：已完成",
      c.url,
      "已提交",
      "assignment",
      "演示数据：已提交的作业。",
      "2026-10-20 23:59",
      true,
    ),
  ],
};
const fixturePath = join(root, "fixture.json");
writeFileSync(fixturePath, JSON.stringify(fixture));
const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    REMINDER_DATA_DIR: root,
    REMINDER_FIXTURE: fixturePath,
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", "--smoke"], env });
try {
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900),
  );
  await page.getByRole("tab", { name: "全部", exact: true }).click();
  await page.screenshot({ path: join(images, "tasks.png"), fullPage: true });
  await page
    .getByRole("heading", { name: assignment.title, exact: true })
    .click();
  await page.locator("dialog[open]").waitFor();
  await page.screenshot({ path: join(images, "independent-deadlines.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "逾期未提交", exact: true }).click();
  await page.getByRole("heading", { name: late.title, exact: true }).click();
  await page.getByRole("heading", { name: "补交情况", exact: true }).waitFor();
  await page.screenshot({ path: join(images, "late-submission.png") });
  console.log(
    "Created 3 README screenshots from isolated synthetic demo data.",
  );
} finally {
  await app.close();
}
