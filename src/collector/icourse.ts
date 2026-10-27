import type { BrowserContext, Page } from "playwright";
import type { Course, ScanResult, Task } from "../shared/types";
import { checkAuth, safeBody } from "./session";
import {
  clickedPage,
  coverage,
  makeTask,
  attachments,
  attachmentsAt,
  navigate,
  waitList,
  morePages,
} from "./common";
import { uid } from "../domain/time";
import { redactError } from "../domain/security";
type Progress = (message: string) => void;
async function learningPage(
  context: BrowserContext,
  page: Page,
  url: string,
  label?: string,
) {
  await navigate(page, url);
  if (!/\/learn\//.test(new URL(page.url()).pathname)) {
    const enter = page.getByText("已参加，进入学习", { exact: true });
    if (await enter.count()) {
      const target = await clickedPage(context, page, enter);
      await target
        .getByText("测验与作业", { exact: true })
        .first()
        .waitFor({ timeout: 20000 });
      if (target !== page) {
        await navigate(page, target.url());
        await target.close();
      }
    }
  }
  if (label) {
    const nav = page.getByRole("link", { name: label, exact: true });
    if (await nav.count()) {
      await nav.first().click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
}
async function discover(
  context: BrowserContext,
  page: Page,
  report: Progress,
): Promise<Course[]> {
  let personal = await page
    .locator('a[href*="home.htm?userId="]')
    .first()
    .getAttribute("href");
  if (!personal) {
    await page.getByRole("button", { name: "我的课程", exact: true }).click();
    await page.waitForURL(/home\.htm/);
    personal = page.url();
  }
  const home = new URL(personal!, page.url());
  home.hash = "";
  const courses: Course[] = [];
  for (const [tab, platform] of [
    ["course", "mooc"],
    ["spocCourse", "spoc"],
  ] as const) {
    const listUrl = `${home.href}#/home/${tab}`;
    await navigate(page, listUrl);
    await page.waitForFunction(
      () =>
        document.querySelector("#j-coursewrap .course-card-wrapper") ||
        /还没有参加任何课程/.test(document.body.innerText),
      undefined,
      { timeout: 25000 },
    );
    // The page can briefly render an empty placeholder before courses arrive.
    await page.waitForTimeout(1500);
    const selector = "#j-coursewrap .course-card-wrapper";
    for (let p = 0; p < 100; p++) {
      const cards = await page
        .locator(selector)
        .evaluateAll((es) =>
          es
            .map((e, index) => ({
              index,
              text: (e as HTMLElement).innerText,
              title: (
                e.querySelector("img[alt]")?.getAttribute("alt") ||
                e.querySelector(".title")?.textContent ||
                ""
              ).trim(),
            }))
            .filter((x) => x.title),
        );
      for (const card of cards) {
        report(`发现${platform === "spoc" ? "SPOC" : "MOOC"}：${card.title}`);
        const target = await clickedPage(
          context,
          page,
          page
            .locator(selector)
            .nth(card.index)
            .getByText(card.title, { exact: true })
            .first(),
        );
        await target.waitForURL(/\/(?:mooc\/learn|spoc\/learn|learn)\//, {
          timeout: 20000,
        });
        await target
          .getByText("测验与作业", { exact: true })
          .first()
          .waitFor({ timeout: 20000 });
        const url = target.url(),
          remoteId = url.match(
            /\/(?:mooc\/learn|spoc\/learn|learn)\/([^/?#]+)/,
          )?.[1];
        if (remoteId) {
          const term =
            new URL(url).searchParams.get("tid") ||
            card.text.match(/20\d{2}年\d+月\d+日/)?.[0] ||
            "";
          const course = {
            id: uid(platform, remoteId, term),
            platform,
            remoteId,
            term,
            title: card.title,
            url,
            active: !card.text.includes("已结束"),
          };
          if (!courses.some((x) => x.id === course.id)) courses.push(course);
        }
        if (target !== page) await target.close();
        else {
          await navigate(page, listUrl);
          await page.waitForTimeout(1000);
        }
      }
      if (!(await morePages(page))) break;
    }
  }
  return courses;
}
async function scanAssessments(
  context: BrowserContext,
  page: Page,
  course: Course,
  onlySection: "assessments" | "exams",
): Promise<Task[]> {
  const tasks: Task[] = [];
  if (course.platform === "mooc" && /\/mooc\/learn\//.test(course.url)) {
    const root = new URL(course.url);
    root.pathname = root.pathname.replace(
      /\/(content|assessments|exams|announce|certification)(?:\/.*)?$/,
      "/assessments",
    );
    root.hash = "";
    for (const [section, kind] of [
      ["assessments", "quiz"],
      ["exams", "exam"],
    ] as const) {
      if (section !== onlySection) continue;
      root.pathname = root.pathname.replace(
        /\/(assessments|exams)$/,
        "/" + section,
      );
      await learningPage(
        context,
        page,
        root.href,
        section === "assessments" ? "测验与作业" : "考试",
      );
      await waitList(
        page,
        "button.learn-assessment-head[aria-controls]",
        /暂无|没有|未开放|未发布|还未|尚未|暂时|无考试|无测验/,
      );
      const cards = await page
        .locator("button.learn-assessment-head[aria-controls]")
        .evaluateAll((es) =>
          es.map((e) => ({
            control: e.getAttribute("aria-controls") || "",
            title:
              e.querySelector(".learn-assessment-title")?.textContent || "",
            text: (e as HTMLElement).innerText,
          })),
        );
      for (const card of cards) {
        const toggle = page
          .locator(".learn-assessment-head")
          .filter({ hasText: card.title })
          .first();
        if ((await toggle.getAttribute("aria-expanded")) !== "true") {
          await toggle.click();
          // Server-rendered buttons may appear before hydration attaches events.
          // Reobserve the explicit expanded state before one bounded retry.
          try {
            await page.waitForFunction(
              (control) =>
                document
                  .querySelector(
                    `button.learn-assessment-head[aria-controls="${control}"]`,
                  )
                  ?.getAttribute("aria-expanded") === "true",
              card.control,
              { timeout: 1800 },
            );
          } catch {
            if ((await toggle.getAttribute("aria-expanded")) !== "true")
              await toggle.click();
          }
        }
        const panel = page.locator(`[id="${card.control}"]`);
        await panel.waitFor({ state: "visible", timeout: 15000 });
        await panel
          .getByText("正在读取测验得分和作答次数…", { exact: true })
          .waitFor({ state: "hidden", timeout: 15000 })
          .catch(() => {});
        const details = await panel.innerText();
        const body = details
          .split(/测验说明|作业说明|考试说明/)
          .slice(1)
          .join("\n")
          .split(/截止时间/)[0]
          .trim();
        const remote = card.control || uid(card.title);
        const task = makeTask(
          course,
          remote,
          card.title,
          page.url(),
          details,
          kind,
          body,
          card.text,
          true,
        );
        task.attachments = await attachments(page, `[id="${card.control}"]`);
        tasks.push(task);
      }
    }
  } else {
    const base = course.url.split("#")[0];
    for (const [section, kind] of [
      ["testlist", "quiz"],
      ["examlist", "exam"],
    ] as const) {
      if (
        (onlySection === "assessments" && section !== "testlist") ||
        (onlySection === "exams" && section !== "examlist")
      )
        continue;
      await navigate(page, `${base}#/learn/${section}`);
      await waitList(
        page,
        "h4.j-name",
        /未开放|暂无|还未|尚未|没有测验|没有作业|暂无考试/,
      );
      const headings = await page.locator("h4.j-name").allTextContents();
      for (const titleRaw of headings) {
        const title = titleRaw.trim();
        const heading = page
          .locator("h4.j-name")
          .filter({ hasText: title })
          .first();
        const card = heading.locator("../..");
        await heading.click(); // expands the list card; never clicks the start/answer link
        await page.waitForTimeout(200);
        const text = await card.innerText();
        // The old UI only exposes submission URLs after a valid attempt. Keep identity
        // stable before/after submission rather than switching from title to attempt ID.
        const id = uid(title);
        const body = text
          .split(/测验说明|作业说明|考试说明/)
          .slice(1)
          .join("\n")
          .split(/截止时间/)[0]
          .trim();
        const task = makeTask(
          course,
          id,
          title,
          page.url(),
          text,
          kind,
          body,
          text.match(
            /截止时间\s*[:：]?\s*(20\d{2}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/,
          )?.[1] || "",
          true,
        );
        task.attachments = await attachmentsAt(card);
        tasks.push(task);
      }
    }
  }
  return tasks;
}
async function scanAnnouncements(
  context: BrowserContext,
  page: Page,
  course: Course,
): Promise<Task[]> {
  let url = course.url;
  if (/\/mooc\/learn\//.test(url)) {
    const u = new URL(url);
    u.pathname = u.pathname.replace(
      /\/(content|assessments|exams|announce)(?:\/.*)?$/,
      "/announce",
    );
    u.hash = "";
    url = u.href;
  } else url = url.split("#")[0] + "#/learn/announce";
  await learningPage(
    context,
    page,
    url,
    /\/mooc\/learn\//.test(url) ? "公告" : undefined,
  );
  await waitList(
    page,
    ".announcement-richtext, .m-announce, .j-announce, .learn-announcement, .learn-announce-item, .u-announcement, .announce, .j-announceList",
    /暂无公告|没有公告|未发布公告/,
  );
  const tasks: Task[] = [];
  const blocks = await page
    .locator(
      ".announcement-richtext, .j-announce > div, .m-announce .j-content, .learn-announce-item, .learn-announcement, .j-announceList > div, .m-announce",
    )
    .evaluateAll((es) =>
      es
        .filter((e, i, a) => !a.some((p, j) => j !== i && p.contains(e)))
        .map((e) => ({
          title: (
            e.closest("article")?.querySelector("h3,h4,h2")?.textContent ||
            e.querySelector("h3,h4,.title")?.textContent ||
            "课程公告"
          ).trim(),
          text: (e as HTMLElement).innerText,
        }))
        .filter((x) => x.text.trim().length > 3),
    );
  for (const block of blocks) {
    const task = makeTask(
      course,
      uid(block.title, block.text.slice(0, 90)),
      block.title,
      url,
      "",
      "announcement",
      block.text,
      "",
      true,
    );
    task.attachments = await attachments(page);
    tasks.push(task);
  }
  return tasks;
}
export async function scanIcourse(
  context: BrowserContext,
  report: Progress,
): Promise<ScanResult> {
  const result: ScanResult = {
    platform: "icourse",
    courses: [],
    tasks: [],
    coverage: [],
  };
  if (!(await checkAuth(context, "icourse")))
    return { ...result, needsLogin: true, error: "需要重新登录中国大学 MOOC" };
  const page = context.pages()[0] || (await context.newPage());
  result.courses = await discover(context, page, report);
  result.coverage.push(coverage("icourse", "课程发现", result.courses.length));
  for (const course of result.courses.filter((x) => x.active)) {
    for (const section of ["assessments", "exams"] as const) {
      report(
        `${course.title}：${section === "assessments" ? "测验与作业" : "考试"}`,
      );
      try {
        const tasks = await scanAssessments(context, page, course, section);
        result.tasks.push(...tasks);
        result.coverage.push(coverage(course.id, section, tasks.length));
      } catch (error) {
        result.coverage.push(
          coverage(course.id, section, 0, "error", redactError(error)),
        );
      }
    }
    report(`${course.title}：公告`);
    try {
      const tasks = await scanAnnouncements(context, page, course);
      result.tasks.push(...tasks);
      result.coverage.push(coverage(course.id, "announce", tasks.length));
    } catch (error) {
      result.coverage.push(
        coverage(course.id, "announce", 0, "error", redactError(error)),
      );
    }
  }
  return result;
}
