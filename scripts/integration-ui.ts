import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { makeTask } from "../src/collector/common";
import type { ScanResult } from "../src/shared/types";
const root = resolve(".test-data", `integration-ui-${Date.now()}`);
mkdirSync(root, { recursive: true });
const course = {
  id: "ai-course",
  platform: "xjtu" as const,
  remoteId: "1",
  term: "2026",
  title: "线性代数",
  url: "https://lms.xjtu.edu.cn/course/1",
  active: true,
};
const task = makeTask(
  course,
  "1",
  "第三章作业",
  course.url,
  "未交",
  "assignment",
  "请在2026年10月27日交作业",
  "2026-10-30 23:59",
  true,
);
const fixture: ScanResult = {
  platform: "xjtu",
  courses: [course],
  tasks: [task],
  coverage: [],
};
const fixturePath = join(root, "fixture.json");
writeFileSync(fixturePath, JSON.stringify(fixture));
let calls = 0;
const model = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  assert.equal(req.headers.authorization, "Bearer test-ui-secret");
  assert.equal(req.url, "/v1/chat/completions");
  assert.equal(JSON.parse(body).model, "deepseek-flash");
  calls++;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "AI协议回放通过：请按老师日期交作业。",
              candidates: [
                {
                  date: "2026-10-27",
                  quote: "请在2026年10月27日交作业",
                  label: "交作业",
                },
              ],
              warnings: [],
            }),
          },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
const modelPort = (model.address() as any).port;
const temp = createServer();
await new Promise<void>((resolve) => temp.listen(0, "127.0.0.1", resolve));
const apiPort = (temp.address() as any).port;
await new Promise<void>((resolve) => temp.close(() => resolve()));
const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    REMINDER_DATA_DIR: root,
    REMINDER_FIXTURE: fixturePath,
  }).filter((e): e is [string, string] => typeof e[1] === "string"),
);
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  ...(process.argv.includes("--packaged")
    ? {
        executablePath: resolve("release/win-unpacked/课期.exe"),
        args: ["--smoke"],
      }
    : { args: [".", "--smoke"] }),
  env,
  timeout: 30000,
});
try {
  const page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "任务与期限", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "AI 辅助", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("提供商", { exact: true }).inputValue(),
    "deepseek",
  );
  await page
    .getByLabel("API 地址", { exact: true })
    .fill(`http://127.0.0.1:${modelPort}/v1`);
  await page.getByLabel("API Key", { exact: true }).fill("test-ui-secret");
  await page.getByLabel("启用 AI 辅助", { exact: true }).check();
  await page
    .getByLabel(
      "允许将选中任务的说明和已解析附件文字发送至上方服务；服务可能产生费用。",
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "保存 AI 设置", exact: true }).click();
  await page.getByText("AI设置已保存", { exact: true }).waitFor();
  const config = await page.evaluate(() => window.reminder.configuration());
  assert.equal(config.hasAIKey, true);
  assert.equal(config.encryptedStorage, true);
  assert.equal(
    readFileSync(join(root, "credentials.json"), "utf8").includes(
      "test-ui-secret",
    ),
    false,
  );
  await page.getByLabel("开放API端口", { exact: true }).fill(String(apiPort));
  await page.getByLabel("启用本机开放 API", { exact: true }).check();
  await page
    .getByRole("button", { name: "保存 API 设置", exact: true })
    .click();
  await page.getByText("开放API设置已保存", { exact: true }).waitFor();
  await page.getByRole("button", { name: "复制访问令牌", exact: true }).click();
  await page
    .getByText("访问令牌已复制到剪贴板；请只提供给你信任的本机程序", {
      exact: true,
    })
    .waitFor();
  const token = await application.evaluate(({ clipboard }) =>
    clipboard.readText(),
  );
  assert.match(token, /^[a-f0-9]{64}$/);
  const response = await fetch(`http://127.0.0.1:${apiPort}/v1/tasks`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].id, task.id);
  assert.equal(
    (await fetch(`http://127.0.0.1:${apiPort}/v1/tasks`)).status,
    401,
  );
  await page.getByRole("button", { name: "任务与期限", exact: true }).click();
  await page.getByRole("heading", { name: "第三章作业", exact: true }).click();
  await page
    .getByRole("button", { name: "发送给 DeepSeek 分析", exact: true })
    .click();
  await page
    .getByText("AI协议回放通过：请按老师日期交作业。", { exact: true })
    .waitFor();
  assert.equal(calls, 1);
  await page.screenshot({ path: ".runtime/screenshots/ai-analysis.png" });
  const count = (await page.evaluate(() => window.reminder.configuration()))
    .requestsToday;
  assert.equal(count, 1);
  await page.getByRole("button", { name: "关闭任务详情" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "更换令牌", exact: true }).click();
  await page.getByText("已更换令牌；旧令牌立即失效", { exact: true }).waitFor();
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${apiPort}/v1/tasks`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
    401,
  );
  console.log(
    "PASS AI settings UI, local encrypted key storage, consent, selected-task analysis, call budget, local API authorization and token rotation. No live paid model used.",
  );
} finally {
  await application.close();
  await new Promise<void>((resolve) => model.close(() => resolve()));
}
