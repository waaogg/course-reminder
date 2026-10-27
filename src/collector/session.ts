import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { redactError } from "../domain/security";
export const entries = {
  xjtu: "https://lms.xjtu.edu.cn/user/index#/",
  icourse: "https://www.icourse163.org/",
};
export type PlatformAccount = keyof typeof entries;
export function explicitLoginPage(
  platform: PlatformAccount,
  url: string,
  body: string,
) {
  return platform === "xjtu"
    ? /(?:^|\.)identity\d?\.xjtu\.edu\.cn$/.test(new URL(url).hostname)
    : /登录\s*\/?\s*注册/.test(body);
}
export async function launchSession(
  root: string,
  platform: PlatformAccount,
  headed = false,
): Promise<BrowserContext> {
  const profile = join(root, "profiles", platform);
  mkdirSync(profile, { recursive: true });
  return chromium.launchPersistentContext(profile, {
    headless: !headed,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    acceptDownloads: true,
    args: ["--disable-extensions"],
    timeout: 45000,
  });
}
export async function ready(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return (
          text.length > 60 &&
          !/^(加载中|正在加载|请稍候)[。…\s]*$/.test(text.trim())
        );
      },
      undefined,
      { timeout: 20000 },
    )
    .catch(() => {});
}
export async function navigate(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await ready(page);
}
export async function loggedIn(
  page: Page,
  platform: PlatformAccount,
): Promise<boolean> {
  if (platform === "xjtu")
    return (
      /lms\.xjtu\.edu\.cn/.test(page.url()) &&
      (await page.getByText("我的学习", { exact: false }).count()) > 0
    );
  return (
    (await page.locator('a[href*="home.htm?userId="]').count()) > 0 ||
    (await page
      .getByRole("button", { name: "我的课程", exact: true })
      .count()) > 0
  );
}
export async function safeBody(page: Page) {
  return (await page.locator("body").innerText()).slice(0, 160000);
}
export async function checkAuth(
  context: BrowserContext,
  platform: PlatformAccount,
) {
  const page = context.pages()[0] || (await context.newPage());
  try {
    await navigate(page, entries[platform]);
    await page
      .waitForFunction(
        (platform) =>
          platform === "xjtu"
            ? /我的学习/.test(document.body.innerText) ||
              /identity\d?\.xjtu/.test(location.hostname)
            : Boolean(document.querySelector('a[href*="home.htm?userId="]')) ||
              /登录\s*\/?\s*注册/.test(document.body.innerText),
        platform,
        { timeout: 20000 },
      )
      .catch(() => {});
    if (await loggedIn(page, platform)) return true;
    const body = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    if (explicitLoginPage(platform, page.url(), body)) return false;
    throw new Error(
      "暂未确认平台登录状态：页面尚未就绪或结构发生变化，将自动重试；无需立即重新登录。",
    );
  } catch (error) {
    throw new Error(redactError(error));
  }
}
