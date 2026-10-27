import {
  lateSubmission,
  lateRequirement,
  regularDeadline,
} from "../domain/late";
import type { BrowserContext, Page } from "playwright";
import type { Course, ScanResult, Task } from "../shared/types";
import { entries, checkAuth, safeBody } from "./session";
import {
  clickedPage,
  coverage,
  makeTask,
  attachments,
  morePages,
  navigate,
  waitList,
} from "./common";
import { uid } from "../domain/time";
import { redactError } from "../domain/security";
type Progress = (message: string) => void;
async function discover(
  context: BrowserContext,
  page: Page,
  report: Progress,
): Promise<Course[]> {
  await navigate(page, entries.xjtu);
  await waitList(page, ".course-card", /尚未加入|暂无课程|没有课程/);
  const titles = await page
    .locator(".course-card .course-name")
    .allTextContents();
  const term =
    (await safeBody(page)).match(/20\d{2}-20\d{2}第\d学期/)?.[0] || "";
  const courses: Course[] = [];
  for (const raw of titles) {
    const title = raw.trim();
    report(`发现课程：${title}`);
    const card = page
      .locator(".course-card")
      .filter({ has: page.locator(".course-name").filter({ hasText: title }) })
      .filter({ has: page.getByText(title, { exact: true }) })
      .first();
    const target = await clickedPage(
      context,
      page,
      card.locator(".enter").first(),
    );
    await target.waitForURL(/\/course\/\d+\//, { timeout: 15000 });
    const url = target.url(),
      remoteId = url.match(/\/course\/(\d+)/)?.[1];
    if (remoteId)
      courses.push({
        id: uid("xjtu", remoteId, term),
        platform: "xjtu",
        remoteId,
        term,
        title,
        url,
        active: true,
      });
    if (target !== page) await target.close();
    else {
      await navigate(page, entries.xjtu);
      await waitList(page, ".course-card", /暂无课程/);
    }
  }
  return courses;
}
async function readDetail(
  page: Page,
  course: Course,
  listing: { title: string; text: string },
  kind: Task["kind"],
): Promise<Task> {
  await page
    .waitForFunction(
      () => /作业说明|活动时间|测试说明|考试说明/.test(document.body.innerText),
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
  const text = await safeBody(page),
    url = page.url(),
    remote = url.match(/#\/(\d+)/)?.[1] || uid(url, listing.title);
  const body = text
    .split(/作业说明|测试说明|考试说明/)
    .slice(1)
    .join("\n")
    .split(/AIR 学伴/)[0]
    .trim();
  const deadline =
    regularDeadline(text) ||
    listing.text
      .split(/\n/)
      .filter((s) => !/补交|迟交|晚交/.test(s))
      .join("\n")
      .match(/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s+\d{1,2}:\d{2}/)?.[0] ||
    "";
  const task = makeTask(
    course,
    remote,
    listing.title,
    url,
    listing.text + "\n" + text,
    kind,
    body,
    deadline,
    Boolean(body || /活动时间/.test(text)),
  );
  task.lateSubmission = lateSubmission(
    listing.text + "\n" + text,
    url,
    task.updatedAt,
  );
  const late = lateRequirement(task.id, text, url);
  if (listing.text.split(/\n/).some((s) => s.trim() === "要求补交"))
    task.submission = "needs_resubmit";
  if (late)
    task.requirements.push({
      ...late,
      retired: task.lateSubmission.state === "closed",
    });
  task.attachments = await attachments(
    page,
    ".activity-description, .activity-content, .rich-text, .simditor-body, [ng-bind-html], body",
  );
  return task;
}
async function section(
  context: BrowserContext,
  page: Page,
  course: Course,
  path: string,
  kind: Task["kind"],
): Promise<{ tasks: Task[]; count: number }> {
  const url = `https://lms.xjtu.edu.cn/course/${course.remoteId}/${path}#/`;
  await navigate(page, url);
  const selector =
    path === "homework" ? '.list-item[ng-repeat*="homework"]' : ".list-item";
  await waitList(
    page,
    selector,
    /没有任何|暂无|还没有|没有作业|没有测试|没有考试|无测试/,
  );
  const tasks: Task[] = [];
  const seen = new Set<string>();
  for (let p = 0; p < 100; p++) {
    const listUrl = page.url();
    const rows = await page.locator(selector).evaluateAll((elements) =>
      elements
        .map((x) => ({
          title: (
            x.querySelector(".shorten-title, .title, h3")?.textContent || ""
          ).trim(),
          text: (x as HTMLElement).innerText,
        }))
        .filter((x) => x.title),
    );
    for (const row of rows) {
      if (seen.has(row.title)) continue;
      seen.add(row.title);
      const item = page
        .locator(selector)
        .filter({ hasText: row.title })
        .first();
      const target = await clickedPage(
        context,
        page,
        item.locator(".detail, a").first(),
      );
      try {
        tasks.push(await readDetail(target, course, row, kind));
      } finally {
        if (target !== page) await target.close();
        else {
          await navigate(page, listUrl);
          await waitList(page, selector, /暂无|没有任何/);
        }
      }
    }
    if (!(await morePages(page))) return { tasks, count: tasks.length };
  }
  throw new Error("分页超过安全上限，未完成全量读取");
}
export async function scanXjtu(
  context: BrowserContext,
  report: Progress,
): Promise<ScanResult> {
  const result: ScanResult = {
    platform: "xjtu",
    courses: [],
    tasks: [],
    coverage: [],
  };
  if (!(await checkAuth(context, "xjtu")))
    return { ...result, needsLogin: true, error: "需要重新登录思源学堂" };
  const page = context.pages()[0] || (await context.newPage());
  result.courses = await discover(context, page, report);
  result.coverage.push(coverage("xjtu", "课程发现", result.courses.length));
  for (const course of result.courses) {
    for (const [path, kind] of [
      ["homework", "assignment"],
      ["exam", "exam"],
    ] as const) {
      report(`${course.title}：${path === "homework" ? "作业" : "测试"}`);
      try {
        const scan = await section(context, page, course, path, kind);
        result.tasks.push(...scan.tasks);
        result.coverage.push(coverage(course.id, path, scan.count));
      } catch (error) {
        result.coverage.push(
          coverage(course.id, path, 0, "error", redactError(error)),
        );
      }
    }
    report(`${course.title}：公告`);
    try {
      await navigate(
        page,
        `https://lms.xjtu.edu.cn/course/${course.remoteId}/bulletin#/`,
      );
      await waitList(
        page,
        '[ng-repeat*="bulletin"], .bulletin-list .list-item, .bulletin-item',
        /没有任何公告|暂无公告/,
      );
      let count = 0;
      for (let p = 0; p < 100; p++) {
        const blocks = await page
          .locator('[ng-repeat*="bulletin"], .bulletin-item')
          .evaluateAll((es) =>
            es.map((x) => ({
              title: (
                x.querySelector(".title,h3,h2")?.textContent || "课程公告"
              ).trim(),
              text: (x as HTMLElement).innerText,
            })),
          );
        for (const block of blocks) {
          const task = makeTask(
            course,
            uid(block.title, block.text.slice(0, 100)),
            block.title,
            page.url(),
            "",
            "announcement",
            block.text,
            "",
            true,
          );
          task.attachments = await attachments(
            page,
            '[ng-repeat*="bulletin"], .bulletin-item',
          );
          result.tasks.push(task);
          count++;
        }
        if (!(await morePages(page))) break;
      }
      result.coverage.push(coverage(course.id, "bulletin", count));
    } catch (error) {
      result.coverage.push(
        coverage(course.id, "bulletin", 0, "error", redactError(error)),
      );
    }
  }
  return result;
}
