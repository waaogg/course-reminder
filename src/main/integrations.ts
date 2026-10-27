import { randomBytes } from "node:crypto";
import { clipboard } from "electron";
import { z } from "zod";
import type { Store } from "./store";
import { SecretVault } from "./vault";
import { LocalAPI } from "./local-api";
import { analyzeText, aiEndpoint } from "../domain/ai";
import {
  providerDefaults,
  type AIConfig,
  type APIConfig,
  type IntegrationStatus,
  type AIResult,
} from "../shared/integrations";
import { parseDate, todayShanghai, uid } from "../domain/time";
import type { Task, DocumentRecord, Requirement } from "../shared/types";
import type { Snapshot } from "../shared/types";
import { redactError } from "../domain/security";
const aiSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["deepseek", "openai", "anthropic"]),
  baseUrl: z.string().url().max(1000),
  model: z.string().max(200),
  allowCourseText: z.boolean(),
  dailyLimit: z.number().int().min(1).max(100),
  anthropicVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export class Integrations {
  get busy() {
    return this.activeAI > 0;
  }
  private server?: LocalAPI;
  private apiError = "";
  private activeAI = 0;
  constructor(
    private store: Store,
    private vault: SecretVault,
    private sync: () => void,
    private changed: () => void,
    private snapshot?: () => Snapshot,
  ) {}
  ai(): AIConfig {
    return {
      enabled: false,
      provider: "deepseek",
      ...providerDefaults.deepseek,
      allowCourseText: false,
      dailyLimit: 20,
      anthropicVersion: "2023-06-01",
      ...JSON.parse(this.store.getMeta("aiConfig") || "{}"),
    };
  }
  api(): APIConfig {
    return {
      enabled: false,
      port: 18427,
      ...JSON.parse(this.store.getMeta("apiConfig") || "{}"),
    };
  }
  status(): IntegrationStatus {
    return {
      ai: this.ai(),
      api: this.api(),
      hasAIKey: Boolean(this.vault.get("ai:" + this.ai().provider)),
      encryptedStorage: this.vault.available,
      apiRunning: Boolean(this.server),
      apiError: this.apiError,
      apiBaseUrl: `http://127.0.0.1:${this.api().port}`,
      requestsToday: Number(
        this.store.getMeta("aiCount:" + todayShanghai()) || 0,
      ),
    };
  }
  async initialize() {
    await this.vault.initialize();
    await this.restartAPI();
  }
  async saveAI(config: unknown, key?: unknown) {
    const value = aiSchema.parse(config);
    aiEndpoint(value);
    if (typeof key === "string" && key.trim())
      await this.vault.set(
        "ai:" + value.provider,
        z.string().max(2000).parse(key).trim(),
      );
    this.store.setMeta("aiConfig", JSON.stringify(value));
    this.changed();
    return this.status();
  }
  async saveAPI(config: unknown) {
    const value = z
      .object({
        enabled: z.boolean(),
        port: z.number().int().min(1024).max(65535),
      })
      .parse(config);
    this.store.setMeta("apiConfig", JSON.stringify(value));
    await this.restartAPI();
    this.changed();
    return this.status();
  }
  private async token() {
    let token = this.vault.get("local-api");
    if (!token) {
      token = randomBytes(32).toString("hex");
      await this.vault.set("local-api", token);
    }
    return token;
  }
  async copyToken() {
    clipboard.writeText(await this.token());
  }
  async rotateToken() {
    await this.vault.set("local-api", randomBytes(32).toString("hex"));
    await this.restartAPI();
    this.changed();
  }
  async restartAPI() {
    await this.server?.stop();
    this.server = undefined;
    this.apiError = "";
    if (!this.api().enabled) return;
    const server = new LocalAPI(await this.token(), {
      snapshot: () => (this.snapshot ? this.snapshot() : this.store.snapshot()),
      sync: this.sync,
      analyze: (id) => this.analyze(id),
    });
    try {
      await server.start(this.api().port);
      this.server = server;
    } catch (error) {
      this.apiError = redactError(error);
    }
  }
  async analyze(taskId: string): Promise<AIResult> {
    const config = this.ai(),
      task = this.store.get<Task>("tasks", taskId);
    if (!task) throw new Error("找不到该任务");
    if (!config.enabled || !config.allowCourseText)
      throw new Error("请先在设置中启用AI，并允许发送选中的任务文字。");
    const key = this.vault.get("ai:" + config.provider);
    if (!key) throw new Error("请填写当前提供商的API Key");
    if (this.activeAI >= 2) throw new Error("已有AI请求正在处理，请稍后再试");
    const countKey = "aiCount:" + todayShanghai(),
      count = Number(this.store.getMeta(countKey) || 0);
    if (count >= config.dailyLimit)
      throw new Error("已达到今日AI调用次数上限，可在设置中调整。");
    const documents = this.store
      .all<DocumentRecord>("documents")
      .filter(
        (d) =>
          d.taskId === taskId &&
          d.text &&
          task.attachments.some(
            (a) => a.url.split("?")[0] === d.url.split("?")[0],
          ),
      )
      .map((d) => `附件 ${d.name}\n${d.text}`)
      .join("\n");
    const source = `当前本机日期：${todayShanghai()}（只供推断相对日期，不是老师要求）\n任务：${task.title}\n说明：${task.body}\n${documents}`;
    this.store.setMeta(countKey, String(count + 1));
    this.activeAI++;
    try {
      const result = await analyzeText(config, key, source);
      const existing =
        this.store.snapshot().tasks.find((t) => t.id === taskId)
          ?.requirements || [];
      for (const candidate of result.candidates) {
        const parsed = parseDate(
          candidate.date + (candidate.time ? " " + candidate.time : ""),
        );
        if (!parsed) continue;
        if (
          existing.some(
            (r) =>
              r.source === "teacher" &&
              r.date === parsed.date &&
              r.dueAt === parsed.dueAt,
          )
        )
          continue;
        const req: Requirement = {
          id: uid(taskId, "ai", candidate.quote),
          taskId,
          source: "teacher",
          precision: parsed.dueAt ? "datetime" : "date",
          date: parsed.date,
          dueAt: parsed.dueAt,
          original: `AI候选（${config.provider}）：${candidate.quote}`,
          evidenceUrl: task.url,
          confidence: "review",
          completed: false,
          version: 1,
        };
        this.store.mergeRequirement(req);
      }
      this.store.put("events", uid(taskId, "ai", result.at), {
        type: "ai-analysis",
        taskId,
        result,
      });
      this.changed();
      return result;
    } finally {
      this.activeAI--;
    }
  }
  async testAI() {
    const c = this.ai(),
      key = this.vault.get("ai:" + c.provider);
    if (!key) throw new Error("请先保存API Key");
    const countKey = "aiCount:" + todayShanghai(),
      count = Number(this.store.getMeta(countKey) || 0);
    if (count >= c.dailyLimit) throw new Error("已达到今日AI调用次数上限");
    if (this.activeAI >= 2) throw new Error("已有AI请求正在处理，请稍后再试");
    this.store.setMeta(countKey, String(count + 1));
    this.activeAI++;
    try {
      return await analyzeText(
        { ...c, enabled: true, allowCourseText: true },
        key,
        "这是连接测试。请返回summary为“连接正常”、candidates为空数组、warnings为空数组的JSON。",
      );
    } finally {
      this.activeAI--;
    }
  }
  async close() {
    await this.server?.stop();
  }
}
