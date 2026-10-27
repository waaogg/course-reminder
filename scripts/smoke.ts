import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import type { ScanResult } from "../src/shared/types";
import { makeTask } from "../src/collector/common";
import { teacherRequirements } from "../src/domain/time";
mkdirSync(".test-data", { recursive: true });
mkdirSync(".runtime/screenshots", { recursive: true });
const dir = resolve(".test-data", `smoke-${Date.now()}`);
const course = {
  id: "test-course",
  platform: "xjtu" as const,
  remoteId: "1",
  term: "2026",
  title: "线性代数与解析几何I",
  url: "https://lms.xjtu.edu.cn/course/1/content",
  active: true,
};
const task = makeTask(
  course,
  "1",
  "第三章作业",
  course.url,
  "未交",
  "assignment",
  "第3章作业10月27日交",
  "2026-10-30 23:59",
  true,
);
task.requirements = [
  task.requirements[0],
  ...teacherRequirements(
    task.id,
    task.body,
    task.url,
    new Date("2026-10-27T00:00:00Z"),
  ),
];
const fixture: ScanResult = {
  platform: "xjtu",
  courses: [course],
  tasks: [task],
  coverage: [
    {
      courseId: course.id,
      section: "homework",
      status: "success",
      count: 1,
      message: "",
      at: new Date().toISOString(),
    },
  ],
};
const fixturePath = resolve(".test-data", "fixture.json");
writeFileSync(fixturePath, JSON.stringify(fixture));
const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    REMINDER_DATA_DIR: dir,
    REMINDER_FIXTURE: fixturePath,
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = process.argv.includes("--packaged")
  ? {
      executablePath: resolve("release/win-unpacked/课期.exe"),
      args: ["--smoke"],
    }
  : { args: [".", "--smoke"] };
let application = await electron.launch({
  ...launchOptions,
  env,
  timeout: 30000,
});
try {
  let page = await application.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("navigate-notices"),
  );
  await page.getByRole("heading", { name: "通知中心", exact: true }).waitFor();
  await page.getByRole("button", { name: "任务与期限", exact: true }).click();
  if (process.argv.includes("--resources")) {
    const diagnostic = await page.evaluate(() =>
      window.reminder.diagnostics!(),
    );
    assert.equal(diagnostic.browserOK, true);
    assert.match(diagnostic.text.replace(/\s/g, ""), /2026年10月30日/);
    console.log(
      "PASS packaged utilityProcess, bundled browser and local OCR models",
    );
  }
  await page.getByRole("heading", { name: "第三章作业", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  assert.match(await page.locator("dialog").innerText(), /10月27日/);
  assert.match(await page.locator("dialog").innerText(), /10月30日 23:59/);
  await page
    .locator(".requirement-group.teacher")
    .getByRole("button", { name: "标记已完成", exact: true })
    .click();
  await page
    .locator(".requirement-group.teacher")
    .getByRole("button", { name: "已完成 · 撤销" })
    .waitFor();
  let snapshot = await page.evaluate(() => window.reminder.snapshot());
  assert.equal(
    snapshot.tasks[0].requirements.find((r) => r.source === "teacher")
      ?.completed,
    true,
  );
  assert.equal(
    snapshot.tasks[0].requirements.find((r) => r.source === "system")
      ?.completed,
    false,
  );
  await page
    .locator(".requirement-group.teacher")
    .getByRole("button", { name: "校正日期" })
    .click();
  await page.getByLabel("校正后的日期").fill("2026-10-28");
  await page.getByRole("button", { name: "保存校正" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".requirement-group.teacher")
      ?.textContent?.includes("10月28日"),
  );
  await page.screenshot({ path: ".runtime/screenshots/task-detail.png" });
  await page.getByRole("button", { name: "关闭任务详情" }).click();
  await page.getByRole("button", { name: "课程与采集", exact: true }).click();
  await page.getByRole("heading", { name: "课程覆盖", exact: true }).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByText("同步间隔", { exact: true })
    .locator("../..")
    .locator("select")
    .selectOption("15");
  await page.getByRole("button", { name: "通知中心", exact: true }).click();
  await page.getByRole("heading", { name: "通知中心", exact: true }).waitFor();
  await application.close();
  // Restart without the fixture: persisted completion/settings must survive.
  const restartedEnv = { ...env };
  delete restartedEnv.REMINDER_FIXTURE;
  application = await electron.launch({
    ...launchOptions,
    env: restartedEnv,
    timeout: 30000,
  });
  page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.reminder.snapshot());
  assert.equal(snapshot.settings.intervalMinutes, 15);
  assert.equal(
    snapshot.tasks[0].requirements.find((r) => r.source === "teacher")?.date,
    "2026-10-28",
  );
  assert.equal(
    snapshot.tasks[0].requirements.find((r) => r.source === "teacher")
      ?.completed,
    true,
  );
  await page.screenshot({ path: ".runtime/screenshots/tasks.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop launch, independent dates, completion, correction, course coverage, settings and restart persistence",
  );
} finally {
  await application.close();
}
