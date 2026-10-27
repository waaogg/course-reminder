import { launchSession, entries } from "../src/collector/session";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
mkdirSync(".runtime", { recursive: true });
const root =
  process.env.REMINDER_DATA_DIR ||
  join(process.env.APPDATA || ".", "course-reminder");
for (const platform of ["xjtu", "icourse"] as const) {
  const ctx = await launchSession(
    root,
    platform,
    process.argv.includes("--headed"),
  );
  try {
    const p = ctx.pages()[0];
    await p.goto(entries[platform], { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    console.log(platform, {
      url: new URL(p.url()).origin + new URL(p.url()).pathname,
      title: await p.title(),
      myCourses: await p
        .getByRole("button", { name: "我的课程", exact: true })
        .count(),
      privateLinks: await p.locator('a[href*="home.htm?userId="]').count(),
      myLearning: await p.getByText("我的学习", { exact: false }).count(),
      login: await p.getByText("登录", { exact: true }).count(),
    });
    await p.screenshot({ path: `.runtime/${platform}-auth.png` });
  } finally {
    await ctx.close();
  }
}
