import { _electron as electron } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(".test-data", `shortcut-${Date.now()}`);
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
  args: ["--smoke"],
  env,
});
try {
  await application.firstWindow();
  const paths = ["Electron.lnk", "课期.lnk"]
    .map((name) =>
      join(process.env.APPDATA!, "Microsoft/Windows/Start Menu/Programs", name),
    )
    .filter((p) => existsSync(p));
  const records = await application.evaluate(
    ({ shell }, files) =>
      files.map((path) => ({ path, ...shell.readShortcutLink(path) })),
    paths,
  );
  writeFileSync(
    ".runtime/shortcut-verification.json",
    JSON.stringify(records, null, 2),
  );
  console.log(JSON.stringify(records, null, 2));
} finally {
  await application.close();
}
