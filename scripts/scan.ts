import { launchSession } from "../src/collector/session";
import { scanXjtu } from "../src/collector/xjtu";
import { scanIcourse } from "../src/collector/icourse";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
const root =
  process.env.REMINDER_DATA_DIR ||
  join(process.env.APPDATA || ".", "course-reminder");
const platform = process.argv[2] === "icourse" ? "icourse" : "xjtu";
const ctx = await launchSession(
  root,
  platform,
  process.argv.includes("--headed"),
);
try {
  const result = await (platform === "xjtu" ? scanXjtu : scanIcourse)(
    ctx,
    console.log,
  );
  mkdirSync(".runtime", { recursive: true });
  writeFileSync(
    `.runtime/${platform}-scan.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      platform,
      courses: result.courses.length,
      tasks: result.tasks.length,
      coverage: result.coverage,
      error: result.error,
    }),
  );
} finally {
  await ctx.close();
}
