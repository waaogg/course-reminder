# AI与本机开放API实现补充

2026-10-27 用户明确要求两者都要：接入AI服务，以及课期提供开放API。指定DeepSeek为默认提供商，保留OpenAI和Anthropic兼容。

## AI
- 默认提供商DeepSeek，官方地址`https://api.deepseek.com`，默认模型`deepseek-flash`。2026-10-27已核对DeepSeek官方文档；不沿用旧的deepseek-chat作为未经验证的默认值。
- OpenAI兼容调用`/chat/completions`，Anthropic兼容调用`/messages`；地址与模型名可编辑，支持本机HTTP兼容服务与远端HTTPS。用户在应用内填写自己的Key。
- AI默认关闭；启用后仍只在用户点击某任务分析，或持有本机令牌的程序请求该任务分析时，发送该任务说明及已解析附件文字。配置中明确允许发送的范围与可能费用。
- 返回中文摘要、日期候选、原文引用与不确定点。候选必须能在输入文字中定位原句；日期做合法性校验；候选保存为teacher/review，不能覆盖system字段。确认校正后才进入正常提醒计划。
- 请求有45秒超时、输入截断提示、输出长度限制、最多2个并行请求、每日默认20次上限，不自动重试付费请求。连接测试也计入次数。
- Key与本机API令牌使用Electron safeStorage异步API，由Windows当前用户保护，独立保存在用户数据目录credentials.json，不包含在SQLite业务备份、日志、源码和永久记忆中。系统加密不可用时仅本次运行内保存，不写明文。
- 没有用户真实Key时，可以验证三种协议的本地替身与界面流程，不能宣称已完成真实付费服务连接。

## 本机开放API
- 默认关闭；设置中开启后只监听`127.0.0.1`，默认端口18427，可改。
- 所有端点要求`Authorization: Bearer <token>`，令牌独立随机生成，可复制/更换；不会返回给普通snapshot接口。
- 拒绝网页Origin、错误Host与无效令牌；不启用通配CORS。每分钟请求上限，正文大小与AI日调用次数另有限制。
- `GET /v1/tasks?limit=100&offset=0`：任务及独立日期要求。
- `GET /v1/courses`、`GET /v1/notices`：分页读取课程、通知。
- `GET /v1/status`：平台状态、采集覆盖与下次同步。
- `GET /v1/openapi.json`：携带Bearer鉴权的接口描述。
- `POST /v1/sync`：触发读取同步，不向课程平台提交内容。
- `POST /v1/ai/analyze`，正文`{"taskId":"任务ID"}`：仅分析已采集任务，需应用中AI配置与发送许可都已启用，受同一日限额约束。

示例（需要自行替换令牌，不把真实令牌写入项目）：
```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:18427/v1/tasks' -Headers @{ Authorization = 'Bearer <你的令牌>' }
```

## 依据
- [DeepSeek首个调用及当前模型名](https://api-docs.deepseek.com/)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Anthropic认证](https://platform.claude.com/docs/en/manage-claude/authentication)及[Messages](https://platform.claude.com/docs/en/api/messages/create)：保留x-api-key兼容，版本头可配置，初值2023-06-01用于兼容已有服务。
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：45版同步API已弃用，采用已安装类型声明确认的异步方法；不承诺能抵御同一Windows用户下的恶意程序。

## 1.0.1兼容字段

任务列表使用与界面相同的SPOC优先视图，任务alternateSources保留被折叠MOOC的链接与原提交状态；课程preferredCourseId表示重复课程的首选来源。可选lateSubmission记录state（allowed/closed/unknown）、evidence、observedAt、url；系统要求可选phase=late表示独立补交截止。未带phase的system仍为正常截止，teacher仍是独立老师要求。旧消费者需忽略新增字段，不能把数组中最早/最晚日期替代所有期限。
