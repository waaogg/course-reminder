# 课期 · 学业任务与截止提醒

Windows 本地应用，自动汇总思源学堂和中国大学 MOOC（含 SPOC）的课程任务。老师要求日期和平台系统截止分别保存、展示、提醒。

## 使用

1. 安装 `release/CourseReminder-1.0.2-Setup.exe`，打开课期。
2. 在“课程与采集”分别登录两个平台，完成后按窗口提示结束登录。已有本机专用登录状态会复用。
3. 程序后台自动发现课程并定时扫描，默认间隔30分钟。无需逐门打开课程或点击同步。
4. 在“设置”测试系统通知，可选择登录 Windows 时启动。关闭主窗口会收至托盘；托盘“退出”才停止程序。
5. 任务详情可查看来源、分别标记老师要求与系统任务的完成状态，以及本地校正日期。完成标记不向平台提交作业。

电脑关机、休眠、程序退出时不能采集或提醒。首次登录、会话失效或验证码仍需本人处理。查看“课程与采集”的覆盖情况与错误；旧数据在部分扫描失败时保留，不能把它当作刚刚核验的数据。

## 任务状态与补交

“已完成”与“逾期未提交”分别查看。成功读取但页面未显示提交状态时显示“无提交状态”，不列入待核对；已提交任务的独立老师要求仍在“老师待办”。重复MOOC任务优先展示SPOC，详情保留其他来源，不把MOOC提交状态转移到SPOC。

思源可能允许补交。明确证据时显示“逾期可补交”，补交截止独立记录和提醒；成功读取但没有规则时显示“无补交说明”，不因正常截止已过就认定无法提交。详情保存读取时间，请以平台最新页面为准。

## AI

“设置 → AI 辅助”默认 DeepSeek，保留 OpenAI、Anthropic 协议兼容。填写服务地址、模型、API Key 后保存。Key 使用本机系统加密，与 SQLite 备份分开保存。

只有启用并允许发送课程文字后，任务详情中的分析按钮才会将该任务说明和相关已解析附件文字发送至所选服务。按提供商规则可能收费；有每日次数上限，无后台自动付费分析。AI 候选日期进入待核对，不能修改系统截止。正式服务需用户自行提供有效 Key；开发验证使用本地模拟上游，不代表真实付费账号已验证。

## 本机开放 API

在设置中启用，默认地址 `http://127.0.0.1:18427`，仅本机监听。点击“复制访问令牌”，调用时携带 `Authorization: Bearer <令牌>`。更换令牌会使旧令牌失效。

| 请求 | 用途 |
|---|---|
| GET /v1/status | 当前状态 |
| GET /v1/tasks | 任务列表 |
| GET /v1/courses | 课程列表 |
| GET /v1/notices | 通知列表 |
| GET /v1/openapi.json | 接口说明 |
| POST /v1/sync | 请求后台同步 |
| POST /v1/ai/analyze | 分析任务，JSON 请求体 `{"taskId":"任务ID"}` |

AI 接口共用授权与调用上限。API 不提供提交作业或修改课程平台内容的功能。不要把令牌放进日志、仓库或网页脚本。

## 数据与附件

用户数据目录：`%APPDATA%\course-reminder`。设置中可打开目录、备份及恢复 SQLite 数据。备份不包含登录状态与 API Key。恢复前会保留当前数据库副本。

支持 PDF 文本、扫描 PDF、本地图片 OCR、DOCX 正文及内嵌图片 OCR、XLSX 单元格文本。单文件25MB、PDF最多30页、DOCX最多20张 PNG/JPEG/WebP 图片，受限或不支持的内容显示部分解析状态。旧 DOC/XLS、PPT、压缩包、加密文档、复杂图片表格不能保证自动解析；应结合原始来源核对。OCR 与日期识别可能有误，疑似日期须人工核对。

## 开发与验证

Node.js24、Windows x64。`npm install` 后运行：

```powershell
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:store
npm run build
npm run test:e2e
npx tsx scripts/integration-ui.ts
npx tsx scripts/restore-check.ts
npm run dist:win
npx tsx scripts/smoke.ts --packaged --resources
npx tsx scripts/integration-ui.ts --packaged
```

打包包含专用 Chromium 和中文/英文 OCR 模型，安装包较大。未配置代码签名证书，Windows 可能显示发布者未知。项目续接从 `AGENTS.md` 和 `PROGRESS.md` 开始；测试状态以当前进度记录为准，文中的命令不等于全部已经验收。

## 源码开发

使用Node.js与npm。克隆后运行 `npm ci`，再运行 `npm run setup:browser`。`npm run typecheck`、`npm run test:unit`、`npm run test:integration` 用于检查，`npm run dev` 启动开发界面，`npm run dist:win` 生成Windows安装包（自动准备浏览器和OCR资源）。

仓库不包含本机登录状态、课程数据库、运行快照、MEMORIES.md、PROGRESS.md及私人平台调查记录；这些仍保存在原电脑。新电脑开发从README、docs/PLAN.md、docs/IMPLEMENTATION-PLAN.md开始，并自行登录课程平台。安装包在本机release目录生成，不随源码推送。
