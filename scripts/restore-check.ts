import { _electron as electron } from "playwright";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(".test-data", `restore-${Date.now()}`);
mkdirSync(root, { recursive: true });
const backup = join(root, "checkpoint.sqlite");
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, REMINDER_DATA_DIR: root }).filter(
    (x): x is [string, string] => typeof x[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.REMINDER_FIXTURE;
const launch = () =>
  electron.launch({
    ...(process.argv.includes("--packaged")
      ? {
          executablePath: resolve("release/win-unpacked/课期.exe"),
          args: ["--smoke"],
        }
      : { args: [".", "--smoke"] }),
    env,
  });
let application = await launch();
try {
  let page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  const initial = await page.evaluate(() => window.reminder.snapshot());
  await page.evaluate(
    (s) => window.reminder.saveSettings({ ...s, intervalMinutes: 15 }),
    initial.settings,
  );
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as any;
  }, backup);
  assert.equal(await page.evaluate(() => window.reminder.backup()), backup);
  assert.equal(existsSync(backup), true);
  await page.evaluate(
    (s) => window.reminder.saveSettings({ ...s, intervalMinutes: 60 }),
    initial.settings,
  );
  await application.evaluate(({ dialog, app }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as any;
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false,
    })) as any;
    app.relaunch = () => {}; // The test itself relaunches with the same isolated data.
  }, backup);
  const closed = application.waitForEvent("close");
  await page.evaluate(() => window.reminder.restore()).catch(() => {});
  await closed;
  assert.ok(
    readdirSync(join(root, "backups")).some((name) =>
      name.startsWith("before-restore-"),
    ),
  );
  assert.ok(
    readdirSync(join(root, "backups")).some((name) =>
      name.startsWith("replaced-"),
    ),
  );
  application = await launch();
  page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.reminder.snapshot())).settings
      .intervalMinutes,
    15,
  );
  console.log(
    "PASS complete main-process backup/restore/restart path in isolated data; pre-restore and replaced databases retained. Native file choices were supplied by the test.",
  );
} finally {
  await application.close().catch(() => {});
}
