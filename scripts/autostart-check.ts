import { _electron as electron } from "playwright";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const root = resolve(".test-data", `autostart-${Date.now()}`);
mkdirSync(root, { recursive: true });
const env: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, REMINDER_DATA_DIR: root }).filter(
    (x): x is [string, string] => typeof x[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.REMINDER_FIXTURE;
const application = await electron.launch({
  executablePath:
    "C:/Users/WaaoGG/AppData/Local/Programs/course-reminder/课期.exe",
  args: [],
  env,
});
try {
  const page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  const initial = await page.evaluate(() => window.reminder.snapshot());
  const before = await application.evaluate(({ app }) =>
    app.getLoginItemSettings({
      path: process.execPath,
      args: ["--background"],
    }),
  );
  try {
    await page.evaluate(
      (s) =>
        window.reminder.saveSettings({
          ...s,
          notifications: false,
          autoStart: true,
        }),
      initial.settings,
    );
    assert.equal(
      (
        await application.evaluate(({ app }) =>
          app.getLoginItemSettings({
            path: process.execPath,
            args: ["--background"],
          }),
        )
      ).openAtLogin,
      true,
    );
    await page.evaluate(
      (s) =>
        window.reminder.saveSettings({
          ...s,
          notifications: false,
          autoStart: false,
        }),
      initial.settings,
    );
    assert.equal(
      (
        await application.evaluate(({ app }) =>
          app.getLoginItemSettings({
            path: process.execPath,
            args: ["--background"],
          }),
        )
      ).openAtLogin,
      false,
    );
    console.log(
      "PASS installed settings register and remove Windows login startup. No reboot performed.",
    );
  } finally {
    await application.evaluate(
      ({ app }, enabled) =>
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
          args: ["--background"],
        }),
      before.openAtLogin,
    );
  }
} finally {
  await application.close();
}
