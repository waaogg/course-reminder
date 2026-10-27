import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(".test-data", `notification-${Date.now()}`);
mkdirSync(root, { recursive: true });
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, REMINDER_DATA_DIR: root }).filter(
    (x): x is [string, string] => typeof x[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.REMINDER_FIXTURE;
const real=process.argv.includes('--real');
if(real)delete env.REMINDER_DATA_DIR;
const application = await electron.launch({
  ...(process.argv.includes("--dev")
    ? { args: [".", "--smoke"] }
    : {
        executablePath:
          "C:/Users/WaaoGG/AppData/Local/Programs/course-reminder/课期.exe",
        args: real ? [] : ["--smoke"],
      }),
  env,
});
try {
  const page = await application.firstWindow();
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setTitle('课期通知验收（隔离测试）'));
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "发送测试通知", exact: true }).click();
  console.log(
    "Installed app requested a genuine Windows notification. Waiting for human-visible delivery and click.",
  );
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => window.reminder.snapshot());
    const navigated = await page
      .getByRole("heading", { name: "通知中心", exact: true })
      .isVisible();
    const record = {
      at: new Date().toISOString(),
      notices: s.notices.map((n) => ({ title: n.title, status: n.status })),
      navigated,
    };
    writeFileSync(
      ".runtime/notification-verification.json",
      JSON.stringify(record, null, 2),
    );
    if (i === 0 || navigated) console.log(JSON.stringify(record));
    if (navigated || existsSync(".runtime/stop-notification")) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
} finally {
  await application.close();
}
