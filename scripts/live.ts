import { _electron as electron } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (x): x is [string, string] => typeof x[1] === "string",
  ),
);
delete env.ELECTRON_RUN_AS_NODE;
delete env.REMINDER_FIXTURE;
delete env.REMINDER_DATA_DIR;
const packaged = process.argv.includes("--packaged");
const exeIndex = process.argv.indexOf("--exe");
const selectedExe = exeIndex >= 0 ? process.argv[exeIndex + 1] : undefined;
const application = await electron.launch({
  ...(packaged || selectedExe
    ? {
        executablePath: resolve(selectedExe || "release/win-unpacked/课期.exe"),
        args: [],
      }
    : { args: ["."] }),
  env,
  timeout: 30000,
});
const page = await application.firstWindow();
await page.getByRole("heading", { name: "任务与期限", exact: true }).waitFor();
mkdirSync(".runtime/screenshots", { recursive: true });
console.log(
  "Live app started using existing dedicated logins; no fixture data.",
);
const observations: unknown[] = [];
const initial = await page.evaluate(() => window.reminder.snapshot());
const successRounds = new Map<string, Set<string>>();
await page.evaluate(
  (s) => window.reminder.saveSettings({ ...s, intervalMinutes: 5 }),
  initial.settings,
);
let captured = false;
try {
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(() => window.reminder.snapshot());
    const record = {
      at: new Date().toISOString(),
      courses: s.courses.length,
      tasks: s.tasks.length,
      coverage: s.coverage.length,
      coverageErrors: s.coverage.filter((c) => c.status !== "success").length,
      documents: s.documents.reduce(
        (a, d) => ({ ...a, [d.status]: (a[d.status] || 0) + 1 }),
        {} as Record<string, number>,
      ),
      busy: s.busy,
      accounts: s.accounts.map((a) => ({
        platform: a.platform,
        state: a.state,
        lastSuccess: a.lastSuccess,
        error: a.error,
      })),
      nextSync: s.nextSync,
    };
    observations.push(record);
    writeFileSync(
      ".runtime/live-verification.json",
      JSON.stringify(observations, null, 2),
    );
    console.log(JSON.stringify(record));
    for (const account of s.accounts) {
      if (
        account.lastSuccess &&
        account.lastSuccess !==
          initial.accounts.find((a) => a.platform === account.platform)
            ?.lastSuccess
      ) {
        const rounds = successRounds.get(account.platform) || new Set<string>();
        rounds.add(account.lastSuccess);
        successRounds.set(account.platform, rounds);
      }
    }
    if (
      !captured &&
      s.courses.length >= 20 &&
      s.tasks.length > 0 &&
      !s.busy.length
    ) {
      captured = true;
      await page
        .screenshot({
          path: ".runtime/screenshots/live-tasks.png",
          timeout: 5000,
        })
        .catch(() =>
          console.log(
            "Screenshot unavailable; collection verification continues.",
          ),
        );
    }
    if (process.argv.includes("--hide") && i === 0) {
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.hide(),
      );
      console.log(
        "Main window hidden; scheduled collection remains under observation.",
      );
    }
    if (
      existsSync(".runtime/stop-live") ||
      ((successRounds.get("xjtu")?.size || 0) >= 2 &&
        (successRounds.get("icourse")?.size || 0) >= 2)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
} finally {
  await page
    .evaluate(
      (s) => window.reminder.saveSettings({ ...s, intervalMinutes: 30 }),
      initial.settings,
    )
    .catch(() => {});
  await application.close();
}
