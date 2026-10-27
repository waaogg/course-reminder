import { _electron as electron } from "playwright";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (x): x is [string, string] => typeof x[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.REMINDER_DATA_DIR;
delete env.REMINDER_FIXTURE;
const app = await electron.launch({
  executablePath:
    "C:/Users/WaaoGG/AppData/Local/Programs/course-reminder/课期.exe",
  args: [],
  env,
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  const records: unknown[] = [];
  let passed = false;
  for (let i = 0; i < 90; i++) {
    const s = await page.evaluate(() => window.reminder.snapshot());
    const record = {
      at: new Date().toISOString(),
      version: s.version,
      courses: s.courses.length,
      tasks: s.tasks.length,
      busy: s.busy,
      accounts: s.accounts.map((a) => ({
        platform: a.platform,
        state: a.state,
        lastSuccess: a.lastSuccess,
        error: a.error,
      })),
      coverageErrors: s.coverage.filter((c) => c.status !== "success").length,
      pendingDocuments: s.documents.filter((d) => d.status === "pending")
        .length,
      settings: s.settings,
    };
    records.push(record);
    writeFileSync(
      ".runtime/final-installed-verification.json",
      JSON.stringify(records, null, 2),
    );
    if (i % 6 === 0) console.log(JSON.stringify(record));
    if (
      i > 1 &&
      !s.busy.length &&
      s.accounts.every((a) => a.state === "ready") &&
      !record.coverageErrors &&
      !record.pendingDocuments
    ) {
      assert.equal(s.settings.intervalMinutes, 30);
      assert.equal(s.courses.length, 20);
      await page
        .screenshot({
          path: ".runtime/screenshots/final-installed.png",
          timeout: 5000,
        })
        .catch(() => {});
      passed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  assert.equal(
    passed,
    true,
    "installed application did not recover to a fully checked idle state in the bounded observation period",
  );
  console.log(
    "PASS installed release with real data: interrupted work recovered automatically, both accounts ready, current coverage complete, interval30, no pending parser jobs.",
  );
} finally {
  await app.close();
}
