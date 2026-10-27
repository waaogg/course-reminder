import { launchSession, navigate } from "../src/collector/session";
import { join } from "node:path";
import { clickedPage } from "../src/collector/common";
const root =
  process.env.REMINDER_DATA_DIR ||
  join(process.env.APPDATA || ".", "course-reminder");
const ctx = await launchSession(root, "icourse");
try {
  let p = ctx.pages()[0];
  await navigate(
    p,
    "https://www.icourse163.org/mooc/learn/XJTU-1002104010/assessments?tid=1487836459",
  );
  await p.waitForTimeout(1500);
  await p.waitForTimeout(4000);
  const enter = p.getByText("已参加，进入学习", { exact: true });
  if (await enter.count()) {
    p = await clickedPage(ctx, p, enter);
    await p.getByText("测验与作业", { exact: true }).first().waitFor();
    await p.getByText("测验与作业", { exact: true }).first().click();
    await p.waitForTimeout(1500);
  }
  console.log("BODY", (await p.locator("body").innerText()).slice(0, 7500));
  console.log(
    "ASSESSMENT_ELEMENTS",
    await p.locator("[class]").evaluateAll((es) =>
      es
        .filter((x) => /assessment/i.test(x.className))
        .slice(0, 20)
        .map((x) => ({
          tag: x.tagName,
          class: x.className,
          html: x.outerHTML.slice(0, 1000),
        })),
    ),
  );
  await p.screenshot({ path: ".runtime/mooc-new-debug.png" });
  if (await p.locator(".learn-assessment-head").count())
    console.log(
      "HEAD",
      await p
        .locator(".learn-assessment-head")
        .first()
        .evaluate((e) => e.parentElement?.outerHTML.slice(0, 8500)),
    );
  console.log(
    "EXPANDERS",
    await p
      .locator("[aria-expanded]")
      .evaluateAll((es) =>
        es.map((x) => ({
          tag: x.tagName,
          class: x.className,
          control: x.getAttribute("aria-controls"),
          text: x.textContent?.slice(0, 100),
        })),
      ),
  );
  await navigate(
    p,
    "https://www.icourse163.org/mooc/learn/XJTU-1002104010/announce?tid=1487836459",
  );
  await p.waitForTimeout(1000);
  console.log(
    "ANNOUNCE",
    await p.locator("[class]").evaluateAll((es) =>
      es
        .filter((x) => /announ|notice/i.test(x.className))
        .slice(0, 20)
        .map((x) => ({
          class: x.className,
          text: x.textContent?.slice(0, 80),
          html: x.outerHTML.slice(0, 1200),
        })),
    ),
  );
  await navigate(
    p,
    "https://www.icourse163.org/mooc/learn/XJTU-1002104010/exams?tid=1487836459",
  );
  await p.waitForTimeout(1200);
  console.log(
    "EXAMS",
    (await p.locator("#learn-main-content").innerText()).slice(0, 3500),
  );
  console.log(
    "EXAMHEAD",
    await p
      .locator(".learn-assessment-head")
      .evaluateAll((es) => es.map((e) => e.outerHTML.slice(0, 2000))),
  );
} finally {
  await ctx.close();
}
