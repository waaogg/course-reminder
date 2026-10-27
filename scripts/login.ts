import { launchSession, entries, loggedIn } from "../src/collector/session";
import { join } from "node:path";
const root =
  process.env.REMINDER_DATA_DIR ||
  join(process.env.APPDATA || ".", "course-reminder");
const platform = process.argv[2] === "icourse" ? "icourse" : "xjtu";
const context = await launchSession(root, platform, true);
const page = context.pages()[0] || (await context.newPage());
await page.goto(entries[platform]);
console.log(
  `请在专用窗口完成 ${platform} 登录。登录状态保存在应用本地目录，不导出任何认证秘密。`,
);
const check = setInterval(async () => {
  try {
    if (await loggedIn(page, platform)) {
      clearInterval(check);
      console.log(`${platform}: login ready`);
      await context.close();
    }
  } catch {
    clearInterval(check);
  }
}, 3000);
context.on("close", () => {
  clearInterval(check);
  process.exit(0);
});
