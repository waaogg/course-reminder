import { launchSession, checkAuth, navigate } from "../src/collector/session";
import { join } from "node:path";
const ctx = await launchSession(
  join(process.env.APPDATA || ".", "course-reminder"),
  "icourse",
);
try {
  const p = ctx.pages()[0];
  await checkAuth(ctx, "icourse");
  await navigate(
    p,
    "https://www.icourse163.org/mooc/learn/XJTU-1002104010/content?tid=1487836459",
  );
  await p.getByRole("link", { name: "测验与作业", exact: true }).click();
  await p.locator("button.learn-assessment-head").first().waitFor();
  const button = p.locator("button.learn-assessment-head").first();
  console.log("BEFORE", await button.getAttribute("aria-expanded"));
  await button.click();
  console.log("AFTER", await button.getAttribute("aria-expanded"));
  await p.waitForTimeout(1500);
  console.log("SETTLED", await button.getAttribute("aria-expanded"));
  console.log(
    "PANEL",
    await p.locator(".learn-assessment-card").first().innerText(),
  );
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
    await p.waitForTimeout(1500);
    console.log("RETRY", await button.getAttribute("aria-expanded"));
    console.log(
      "PANEL2",
      await p.locator(".learn-assessment-card").first().innerText(),
    );
  }
} finally {
  await ctx.close();
}
