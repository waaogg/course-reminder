import { useEffect, useState } from "react";
import { Sparkles, Code2, Copy, RefreshCw } from "lucide-react";
import {
  providerDefaults,
  type AIProvider,
  type IntegrationStatus,
} from "../../shared/integrations";
const api = window.reminder;
export function IntegrationSettings() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null),
    [key, setKey] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .configuration()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);
  async function run(fn: () => Promise<unknown>, text = "") {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await fn();
      setKey("");
      const next = await api.configuration();
      setStatus(next);
      setMessage(text);
    } catch (e) {
      setError(
        String(e).replace(
          /^Error: Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!status)
    return (
      <section className="settings-section">
        <h2>AI 与开放 API</h2>
        <p>{error || "正在读取连接设置…"}</p>
      </section>
    );
  const ai = status.ai;
  function patchAI(change: Partial<typeof ai>) {
    setStatus((current) =>
      current ? { ...current, ai: { ...current.ai, ...change } } : current,
    );
  }
  return (
    <>
      <section className="settings-section integration-settings">
        <h2>
          <Sparkles size={18} />
          AI 辅助
        </h2>
        <p className="setting-explanation">
          识别模糊日期、整理要求与说明。仅在你点击分析时发送所选任务的文字，AI
          结果始终作为待核对候选。
        </p>
        {error && (
          <p className="integration-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="integration-message" role="status">
            {message}
          </p>
        )}
        <div className="integration-form">
          <label>
            提供商
            <select
            aria-label="提供商"
              value={ai.provider}
              onChange={(e) => {
                const provider = e.target.value as AIProvider;
                patchAI({ provider, ...providerDefaults[provider] });
                setKey("");
              }}
            >
              <option value="deepseek">DeepSeek（默认）</option>
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Anthropic 兼容</option>
            </select>
          </label>
          <label>
            模型名
            <input
              value={ai.model}
              onChange={(e) => patchAI({ model: e.target.value })}
              placeholder="填写该服务支持的模型名"
            />
          </label>
          <label className="wide">
            API 地址
            <input
              value={ai.baseUrl}
              onChange={(e) => patchAI({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label className="wide">
            API Key
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                status.hasAIKey
                  ? "已保存密钥；留空保留原值"
                  : "在这里填写，不要发到聊天中"
              }
            />
          </label>
          <label>
            每日调用次数上限
            <input
              type="number"
              min="1"
              max="100"
              value={ai.dailyLimit}
              onChange={(e) => patchAI({ dailyLimit: Number(e.target.value) })}
            />
          </label>
          {ai.provider === "anthropic" && (
            <label>
              Anthropic API 版本
              <input
                value={ai.anthropicVersion}
                onChange={(e) => patchAI({ anthropicVersion: e.target.value })}
              />
            </label>
          )}
        </div>
        <label className="consent">
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={(e) => patchAI({ enabled: e.target.checked })}
          />
          启用 AI 辅助
        </label>
        <label className="consent">
          <input
            type="checkbox"
            checked={ai.allowCourseText}
            onChange={(e) => patchAI({ allowCourseText: e.target.checked })}
          />
          允许将选中任务的说明和已解析附件文字发送至上方服务；服务可能产生费用。
        </label>
        <p className="setting-explanation">
          {status.encryptedStorage
            ? "密钥使用 Windows 提供的本机加密保护，业务备份不包含密钥。"
            : "系统加密暂不可用：密钥只保留在本次运行内，不写入明文文件。"}
          今日已调用 {status.requestsToday} 次。
        </p>
        <div className="button-row">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => run(() => api.saveAI(ai, key), "AI设置已保存")}
          >
            保存 AI 设置
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.saveAI(ai, key);
                const result = await api.testAI();
                if (!result.summary) throw new Error("连接未返回摘要");
              }, "AI连接正常（已调用一次服务）")
            }
          >
            {busy ? (
              <RefreshCw className="spinning" size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            保存并测试连接
          </button>
        </div>
      </section>
      <section className="settings-section integration-settings">
        <h2>
          <Code2 size={18} />
          本机开放 API
        </h2>
        <p className="setting-explanation">
          为其他程序提供课程、任务、通知、采集状态，以及触发同步和 AI
          分析。只监听 127.0.0.1，所有请求必须携带独立访问令牌。
        </p>
        <div className="integration-form">
          <label>
            端口
            <input
              aria-label="开放API端口"
              type="number"
              min="1024"
              max="65535"
              value={status.api.port}
              onChange={(e) =>
                setStatus({
                  ...status,
                  api: { ...status.api, port: Number(e.target.value) },
                })
              }
            />
          </label>
          <div className="api-state">
            <span className={status.apiRunning ? "connected" : ""}>
              {status.apiRunning ? "正在运行" : "尚未启用"}
            </span>
            <code>{status.apiBaseUrl}</code>
          </div>
        </div>
        <label className="consent">
          <input
            type="checkbox"
            checked={status.api.enabled}
            onChange={(e) =>
              setStatus({
                ...status,
                api: { ...status.api, enabled: e.target.checked },
              })
            }
          />
          启用本机开放 API
        </label>
        {status.apiError && (
          <p className="integration-error">{status.apiError}</p>
        )}
        <div className="button-row">
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(() => api.saveAPI(status.api), "开放API设置已保存")
            }
          >
            保存 API 设置
          </button>
          <button
            className="button secondary"
            onClick={() =>
              run(
                () => api.copyAPIToken(),
                "访问令牌已复制到剪贴板；请只提供给你信任的本机程序",
              )
            }
          >
            <Copy size={14} />
            复制访问令牌
          </button>
          <button
            className="button secondary"
            onClick={() =>
              run(() => api.rotateAPIToken(), "已更换令牌；旧令牌立即失效")
            }
          >
            更换令牌
          </button>
        </div>
        <pre className="api-example">{`GET ${status.apiBaseUrl}/v1/tasks\nAuthorization: Bearer <你的访问令牌>\n\nGET /v1/courses\nGET /v1/status\nGET /v1/notices\nGET /v1/openapi.json\nPOST /v1/sync\nPOST /v1/ai/analyze  {"taskId":"..."}`}</pre>
      </section>
    </>
  );
}
export function TaskAI({
  taskId,
  onChanged,
}: {
  taskId: string;
  onChanged: () => void;
}) {
  const [result, setResult] = useState<Awaited<
      ReturnType<typeof api.analyzeTask>
    > | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [provider, setProvider] = useState("DeepSeek");
  useEffect(() => {
    setResult(null);
    setError("");
    api
      .configuration()
      .then((s) =>
        setProvider(
          s.ai.provider === "deepseek"
            ? "DeepSeek"
            : s.ai.provider === "openai"
              ? "OpenAI兼容服务"
              : "Anthropic兼容服务",
        ),
      );
  }, [taskId]);
  return (
    <section className="evidence task-ai">
      <h2>
        <Sparkles size={16} />
        AI 辅助核对
      </h2>
      <p className="setting-explanation">
        发送本任务说明及已提取的附件文字到 {provider}。AI
        不会修改系统截止，识别出的新日期将进入待核对。
      </p>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setResult(await api.analyzeTask(taskId));
            onChanged();
          } catch (e) {
            setError(
              String(e).replace(
                /^Error: Error invoking remote method '[^']+': Error: /,
                "",
              ),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <RefreshCw className="spinning" size={15} />
        ) : (
          <Sparkles size={15} />
        )}{" "}
        {busy ? "正在分析…" : `发送给 ${provider} 分析`}
      </button>
      {error && (
        <p className="integration-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="ai-result">
          <p>{result.summary}</p>
          {result.candidates.map((c, i) => (
            <blockquote key={i}>
              <strong>
                {c.label}：{c.date}
                {c.time ? " " + c.time : ""}
              </strong>
              <span>{c.quote}</span>
            </blockquote>
          ))}
          {result.warnings.map((w, i) => (
            <p className="muted" key={i}>
              {w}
            </p>
          ))}
          <small>
            {result.provider} / {result.model} · AI建议需核对原文
          </small>
        </div>
      )}
    </section>
  );
}
