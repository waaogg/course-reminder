import { launchSession, checkAuth, navigate } from "../src/collector/session";
import { join } from "node:path";
const root =
  process.env.REMINDER_DATA_DIR ||
  join(process.env.APPDATA || ".", "course-reminder");
const ctx = await launchSession(root, "icourse");
try {
  console.log("ICOURSE_AUTH", await checkAuth(ctx, "icourse"));
  const p = ctx.pages()[0];
  let href = await p
    .locator('a[href*="home.htm?userId="]')
    .first()
    .getAttribute("href");
  if (!href) {
    await p.getByRole("button", { name: "我的课程", exact: true }).click();
    await p.waitForURL(/home\.htm/);
    href = p.url();
  }
  const home = new URL(href!, p.url());
  home.hash = "/home/spocCourse";
  await navigate(p, home.href);
  await p.waitForTimeout(5000);
  console.log(
    "PERSONAL_DOM",
    await p.locator("[class],[id]").evaluateAll((es) =>
      es
        .filter((x) => /course|cnt1|spoc/i.test(x.className + " " + x.id))
        .slice(0, 24)
        .map((x) => ({
          tag: x.tagName,
          id: x.id,
          class: x.className,
          html: x.outerHTML.slice(0, 1000),
        })),
    ),
  );
  await p.screenshot({ path: ".runtime/mooc-personal.png" });
  await navigate(
    p,
    "https://www.icourse163.org/spoc/learn/XJTU-1469715211#/learn/testlist",
  );
  await p.waitForTimeout(1500);
  console.log(
    "SPOC_TEST",
    await p
      .locator("h4")
      .evaluateAll((es) =>
        es
          .slice(0, 10)
          .map((x) => ({
            title: x.textContent,
            html: x.parentElement?.outerHTML.slice(0, 2200),
          })),
      ),
  );
  await navigate(
    p,
    "https://www.icourse163.org/spoc/learn/XJTU-1469715211#/learn/announce",
  );
  await p.waitForTimeout(1800);
  console.log(
    "ANNOUNCE",
    await p.locator("[class],[id]").evaluateAll((es) =>
      es
        .filter((e) => /announce/i.test(e.className + " " + e.id))
        .slice(0, 16)
        .map((e) => ({
          tag: e.tagName,
          id: e.id,
          class: e.className,
          text: e.textContent?.slice(0, 80),
        })),
    ),
  );
} finally {
  await ctx.close();
}
