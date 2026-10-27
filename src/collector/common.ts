import type { BrowserContext, Page, Locator } from "playwright";
import type { Attachment, Course, Coverage, Task } from "../shared/types";
import {
  classifySubmission,
  systemRequirement,
  teacherRequirements,
  uid,
} from "../domain/time";
import { navigate, ready } from "./session";
export const stamp = () => new Date().toISOString();
export function coverage(
  courseId: string,
  section: string,
  count: number,
  status: Coverage["status"] = "success",
  message = "",
): Coverage {
  return { courseId, section, count, status, message, at: stamp() };
}
export async function clickedPage(
  context: BrowserContext,
  page: Page,
  locator: Locator,
): Promise<Page> {
  const popup = context
    .waitForEvent("page", { timeout: 2500 })
    .catch(() => null);
  await locator.click({ timeout: 12000 });
  const child = await popup;
  const target = child || page;
  await ready(target);
  return target;
}
export async function waitList(page: Page, selector: string, empty: RegExp) {
  await page.waitForFunction(
    ({ selector, pattern }) => {
      const text = document.body?.innerText || "";
      return (
        document.querySelectorAll(selector).length > 0 ||
        new RegExp(pattern).test(text)
      );
    },
    { selector, pattern: empty.source },
    { timeout: 20000 },
  );
}
export async function attachments(
  page: Page,
  selector = "body",
): Promise<Attachment[]> {
  let rootLocator = page.locator("body");
  const candidates =
    selector === "body"
      ? [
          ".activity-description",
          "#learn-main-content",
          ".courseLearn-inner-box",
          "body",
        ]
      : selector.split(",").map((x) => x.trim());
  for (const candidate of candidates)
    if (await page.locator(candidate).count()) {
      rootLocator = page.locator(candidate).first();
      break;
    }
  return attachmentsAt(rootLocator);
}
export async function attachmentsAt(rootLocator:Locator):Promise<Attachment[]>{
  return rootLocator
    .evaluate((root) => {
      const values: { url: string; name: string }[] = [];
      for (const a of Array.from(root.querySelectorAll("a[href]"))) {
        const url = (a as HTMLAnchorElement).href,
          name = (a.textContent || "").trim();
        if (
          /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|webp)(?:[?#]|$)/i.test(url) ||
          /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|webp)$/i.test(name) ||
          /下载附件|附件下载/.test(name)
        )
          values.push({
            url,
            name: name || new URL(url).pathname.split("/").pop() || "课程附件",
          });
      }
      for (const img of Array.from(root.querySelectorAll("img"))) {
        if (
          img.src &&
          !/avatar|logo|icon|large\//i.test(img.src) &&
          (img.naturalWidth > 200 || img.width > 200)
        )
          values.push({ url: img.src, name: (img.alt || "说明图片") + ".png" });
      }
      return Array.from(
        new Map(
          values
            .filter((x) => x.url.startsWith("https://"))
            .map((x) => [x.url, x]),
        ).values(),
      ).slice(0, 100);
    })
    .catch(() => []);
}
export function peerReviewTasks(tasks: Task[], courses: Course[]): Task[] {
  const result = [...tasks];
  for (const task of tasks) {
    const text = task.submissionEvidence + "\n" + task.body;
    if (
      task.kind === "peer_review" ||
      !/学生互评|同学互评|参与互评|互评截止|互评结束/.test(text)
    )
      continue;
    const course = courses.find((c) => c.id === task.courseId);
    if (!course) continue;
    const deadline =
      text.match(
        /互评(?:截止|结束)(?:时间)?\s*[:：]?\s*(20\d{2}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?(?:\s+\d{1,2}:\d{2})?)/,
      )?.[1] || "";
    const peer = makeTask(
      course,
      uid(task.id, "peer-review"),
      `${task.title} · 学生互评`,
      task.url,
      "",
      "peer_review",
      `该任务包含学生互评阶段。${deadline ? "互评截止时间：" + deadline : "尚未读取到明确互评截止时间，请留意课程更新。"}`,
      deadline,
      true,
    );
    const count = text.match(/已互评\s*(\d+)\s*\/\s*(\d+)/);
    if (
      /已完成互评|互评任务已完成/.test(text) ||
      (count && Number(count[1]) >= Number(count[2]) && Number(count[2]) > 0)
    )
      peer.submission = "submitted";
    result.push(peer);
  }
  return result;
}
export function makeTask(
  course: Course,
  remote: string,
  title: string,
  url: string,
  text: string,
  kind: Task["kind"],
  body = "",
  deadlineText = "",
  detailRead = false,
): Task {
  const id = uid(course.id, remote, kind);
  const system = systemRequirement(id, deadlineText, url);
  return {
    id,
    courseId: course.id,
    title: title.trim() || "未命名任务",
    url,
    kind,
    submission: classifySubmission(text),
    submissionEvidence: text.slice(0, 1800),
    body: body.slice(0, 100000),
    requirements: [
      ...(system ? [system] : []),
      ...teacherRequirements(
        id,
        body,
        url,
        system ? new Date(system.dueAt || system.date) : new Date(),
      ),
    ],
    attachments: [],
    detailRead,
    updatedAt: stamp(),
  };
}
export async function morePages(page: Page): Promise<boolean> {
  const next = page
    .locator(
      '.pagination-next:not(.disabled) a, .ivu-page-next:not(.ivu-page-disabled), .pagination .next:not(.disabled) a, a[rel="next"]',
    )
    .first();
  if ((await next.count()) && (await next.isVisible())) {
    const before = await page.locator("body").innerText();
    await next.click();
    await page.waitForFunction(
      (before) => document.body.innerText !== before,
      before,
      { timeout: 12000 },
    );
    return true;
  }
  return false;
}
export { navigate };
