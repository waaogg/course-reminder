import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Tray,
  Menu,
  Notification,
  powerMonitor,
  shell,
  dialog,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  readFileSync,
} from "node:fs";
import Database from "better-sqlite3";
import { z } from "zod";
import { chromium } from "playwright";
import { Store } from "./store";
import { Integrations } from "./integrations";
import { SecretVault } from "./vault";
import { allowedExternal, redactError } from "../domain/security";
import { uid, todayShanghai } from "../domain/time";
import type {
  Notice,
  Requirement,
  Settings,
  ScanResult,
} from "../shared/types";
const here = dirname(fileURLToPath(import.meta.url));
const testMode = process.argv.includes("--smoke");
if (process.env.REMINDER_DATA_DIR)
  app.setPath("userData", process.env.REMINDER_DATA_DIR);
else app.setPath("userData", join(app.getPath("appData"), "course-reminder"));
app.setAppUserModelId(
  app.isPackaged ? "cn.course.reminder" : "cn.course.reminder.development",
);
if (!app.requestSingleInstanceLock()) app.quit();
let window: BrowserWindow,
  tray: Tray,
  store: Store,
  integrations: Integrations,
  quitting = false,
  restoring = false,
  timer: NodeJS.Timeout;
const workers = new Map<string, UtilityProcess>(),
  progress = new Map<string, string>();
// Keep notification wrappers alive after dispatch returns, including while a
// toast resides in Windows Notification Center rather than on screen.
const activeNotifications = new Set<Notification>();
const root = app.getPath("userData");
const assets = app.isPackaged
  ? join(process.resourcesPath, "assets")
  : join(here, "../../resources");
const packagedBrowser = join(assets, "browser");
if (existsSync(packagedBrowser))
  process.env.PLAYWRIGHT_BROWSERS_PATH = packagedBrowser;
if (existsSync(join(assets, "models")))
  process.env.REMINDER_OCR_MODELS = join(assets, "models");
function changed() {
  if (window && !window.isDestroyed()) window.webContents.send("changed");
  updateTray();
}
function updateTray() {
  if (!tray || !store) return;
  const unread = store
    .all<Notice>("notices")
    .filter((x) => !x.read && x.status !== "superseded").length;
  tray.setToolTip(`课期${unread ? ` · ${unread} 条未读提醒` : ""}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开课期",
        click: () => {
          window.show();
          window.focus();
        },
      },
      {
        label: workers.size ? "正在同步…" : "立即同步",
        enabled: !workers.size,
        click: () => syncAll(),
      },
      { type: "separator" },
      { label: "退出（暂停采集与提醒）", click: () => app.quit() },
    ]),
  );
}
function failure(message: string) {
  if (!store) return;
  store.notice(
    uid("error", message, new Date().toISOString().slice(0, 10)),
    "需要检查",
    message,
  );
  changed();
}
function startWorker(platform: "xjtu" | "icourse", mode: "login" | "scan") {
  if (restoring || quitting || workers.has(platform)) return;
  if (mode === "scan")
    setNextAttempt(platform, store.settings().intervalMinutes);
  const child = utilityProcess.fork(
    join(here, "collector.js"),
    [
      JSON.stringify({
        platform,
        root,
        mode,
        attachments: store.settings().scanAttachments,
      }),
    ],
    { stdio: "pipe", env: { ...process.env } },
  );
  workers.set(platform, child);
  store.account(platform, {
    state: "checking",
    lastAttempt: new Date().toISOString(),
    error: undefined,
  });
  changed();
  let gotResult = false,
    authenticated = false;
  child.on("message", (m: any) => {
    if (m.type === "progress") {
      progress.set(platform, m.message);
      changed();
    }
    if (m.type === "authenticated") {
      authenticated = true;
      store.account(platform, { state: "ready", error: undefined });
      changed();
    }
    if (m.type === "result") {
      gotResult = true;
      store.merge(m.result as ScanResult);
      const failed =
        Boolean(m.result.error) ||
        m.result.coverage.some((c: any) => c.status !== "success");
      const failures = failed
        ? Number(store.getMeta("failures:" + platform) || 0) + 1
        : 0;
      store.setMeta("failures:" + platform, String(failures));
      setNextAttempt(
        platform,
        failed
          ? [5, 15, 30][Math.min(failures - 1, 2)]
          : store.settings().intervalMinutes,
      );
      if (m.result.error) failure(m.result.error);
      changed();
    }
    if (m.type === "document") {
      store.document(m.record, m.requirements);
      changed();
    }
    if (m.type === "error") {
      gotResult = true;
      store.account(platform, { state: "error", error: m.message });
      const failures = Number(store.getMeta("failures:" + platform) || 0) + 1;
      store.setMeta("failures:" + platform, String(failures));
      setNextAttempt(platform, [5, 15, 30][Math.min(failures - 1, 2)]);
      failure(m.message);
    }
  });
  const watchdog = setTimeout(
    () => {
      failure(
        `${platform === "xjtu" ? "思源学堂" : "中国大学MOOC"}处理时间过长，本次已停止，历史数据已保留。`,
      );
      child.kill();
    },
    mode === "login" ? 30 * 60000 : 45 * 60000,
  );
  child.on("exit", () => {
    clearTimeout(watchdog);
    workers.delete(platform);
    progress.delete(platform);
    if (quitting) return;
    if (!gotResult && !authenticated)
      store.account(platform, { state: "unknown" });
    changed();
    if (authenticated) startWorker(platform, "scan");
  });
  child.stderr?.on("data", (data) => {
    const msg = String(data);
    if (/Cannot find|MODULE_NOT_FOUND|SyntaxError|ERR_/.test(msg))
      failure(redactError(msg));
  });
}
function setNextAttempt(platform: "xjtu" | "icourse", minutes: number) {
  store.setMeta(
    "nextAttempt:" + platform,
    new Date(Date.now() + minutes * 60000).toISOString(),
  );
  const values = ["xjtu", "icourse"].map((p) =>
    Date.parse(store.getMeta("nextAttempt:" + p) || "0"),
  );
  store.setMeta("nextSync", new Date(Math.min(...values)).toISOString());
}
function syncAll() {
  if (quitting) return;
  for (const platform of ["xjtu", "icourse"] as const)
    startWorker(platform, "scan");
  changed();
}
function navigateNotices() {
  store.setMeta("lastNotificationClick", new Date().toISOString());
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send("navigate-notices");
  changed();
}
function dispatchNotices() {
  store.due();
  if (!store.settings().notifications) return;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const s = store.settings(),
    quiet =
      s.quietStart > s.quietEnd
        ? hour >= s.quietStart || hour < s.quietEnd
        : s.quietStart < s.quietEnd
          ? hour >= s.quietStart && hour < s.quietEnd
          : false;
  if (!Notification.isSupported()) return;
  let pending = store
    .all<Notice>("notices")
    .filter((n) => !n.delivered && !n.read && n.status !== "superseded");
  if (quiet) {
    if (!s.quietUrgent) return;
    let end = Date.parse(
      `${todayShanghai()}T${String(s.quietEnd).padStart(2, "0")}:00:00+08:00`,
    );
    if (end <= Date.now()) end += 86400000;
    pending = pending.filter((n) => {
      const r = n.requirementId
        ? store.get<Requirement>("requirements", n.requirementId)
        : undefined;
      return (
        r &&
        !r.completed &&
        r.dueAt &&
        Date.parse(r.dueAt) > Date.now() &&
        Date.parse(r.dueAt) <= end
      );
    });
  }
  if (!pending.length) return;
  const latest = pending.at(-1)!,
    many = pending.length > 1;
  const notification = new Notification({
    title: many ? `课期 · ${pending.length} 项提醒待查看` : latest.title,
    body: many
      ? pending
          .slice(-3)
          .map((n) => n.title)
          .join("\n")
      : latest.body,
    icon: join(assets, "icon.png"),
  });
  activeNotifications.add(notification);
  for (const n of pending) store.delivered(n.id, "sending");
  notification.on("show", () => {
    for (const n of pending) store.delivered(n.id, "sent");
    changed();
  });
  notification.on("failed", (_, err) => {
    activeNotifications.delete(notification);
    for (const n of pending) store.delivered(n.id, "failed");
    failure("系统通知未显示，请在通知中心查看。" + redactError(err));
  });
  notification.on("click", navigateNotices);
  // Windows 'close' also fires when the toast times out. Keep a bounded
  // reference so clicking its Notification Center entry continues to work.
  while (activeNotifications.size > 64) {
    const oldest = activeNotifications.values().next().value!;
    oldest.close();
    activeNotifications.delete(oldest);
  }
  notification.show();
}
function tick() {
  if (restoring || quitting) return;
  if (quitting) return;
  for (const platform of ["xjtu", "icourse"] as const) {
    const account = store.get<{ state: string }>("accounts", platform);
    if (account?.state === "needs_login" || workers.has(platform)) continue;
    if (
      Date.parse(store.getMeta("nextAttempt:" + platform) || "0") <= Date.now()
    )
      startWorker(platform, "scan");
  }
  dispatchNotices();
  changed();
}
const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(5).max(1440),
  autoStart: z.boolean(),
  quietStart: z.number().int().min(0).max(23),
  quietEnd: z.number().int().min(0).max(23),
  quietUrgent: z.boolean(),
  notifications: z.boolean(),
  scanAttachments: z.boolean(),
});
function handle(name: string, fn: (...args: any[]) => any) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("不允许的来源");
    if (restoring) throw new Error("正在恢复备份，请等待应用重新启动");
    return fn(...args);
  });
}
function wireIPC() {
  handle("configuration", () => integrations.status());
  handle("saveAI", (config: unknown, key: unknown) =>
    integrations.saveAI(config, key),
  );
  handle("saveAPI", (config: unknown) => integrations.saveAPI(config));
  handle("copyAPIToken", () => integrations.copyToken());
  handle("rotateAPIToken", () => integrations.rotateToken());
  handle("analyzeTask", (id: unknown) =>
    integrations.analyze(z.string().max(100).parse(id)),
  );
  handle("testAI", () => integrations.testAI());
  if (testMode)
    handle(
      "diagnostics",
      () =>
        new Promise((resolve, reject) => {
          const child = utilityProcess.fork(
            join(here, "collector.js"),
            [
              JSON.stringify({
                platform: "xjtu",
                root: join(root, "diagnostic"),
                mode: "diagnostic",
                attachments: false,
              }),
            ],
            { stdio: "pipe", env: { ...process.env } },
          );
          const timeout = setTimeout(() => {
            child.kill();
            reject(new Error("打包资源诊断超时"));
          }, 120000);
          let done = false;
          child.on("message", (m: any) => {
            if (m.type === "diagnostic") {
              done = true;
              clearTimeout(timeout);
              resolve(m);
            }
            if (m.type === "error") {
              done = true;
              clearTimeout(timeout);
              reject(new Error(m.message));
            }
          });
          child.on("exit", (code) => {
            clearTimeout(timeout);
            if (!done) reject(new Error(`资源诊断进程退出：${code}`));
          });
          child.stderr?.on("data", (d) =>
            console.error(redactError(String(d))),
          );
        }),
    );
  handle("snapshot", () => ({
    ...store.snapshot([...workers.keys()], app.getVersion()),
    progress: Object.fromEntries(progress),
    browserInstalled: existsSync(chromium.executablePath()),
  }));
  handle("sync", () => syncAll());
  handle("login", (value: unknown) => {
    const platform = z.enum(["xjtu", "icourse"]).parse(value);
    startWorker(platform, "login");
  });
  handle("finishLogin", () => {});
  handle("complete", (id: unknown, done: unknown) => {
    store.complete(z.string().parse(id), z.boolean().parse(done));
    changed();
  });
  handle("correct", (id: unknown, value: unknown) => {
    store.correct(z.string().parse(id), z.string().max(100).parse(value));
    changed();
  });
  handle("readNotice", (id: unknown) => {
    store.readNotice(z.string().parse(id));
    changed();
  });
  handle("snooze", (id: unknown) => {
    store.snooze(z.string().parse(id));
    changed();
  });
  handle("saveSettings", (value: unknown) => {
    const s = settingsSchema.parse(value);
    if (!testMode)
      app.setLoginItemSettings({
        openAtLogin: s.autoStart,
        args: ["--background"],
      });
    store.saveSettings(s);
    for (const p of ["xjtu", "icourse"] as const)
      setNextAttempt(p, s.intervalMinutes);
    changed();
  });
  handle("open", async (value: unknown) => {
    const url = z.string().parse(value);
    const knownDocument = store
      .all<{ url: string }>("documents")
      .some((d) => d.url === url);
    if (!allowedExternal(url) && !knownDocument)
      throw new Error("仅允许打开课程平台或已采集的附件链接");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("链接不安全");
    await shell.openExternal(url);
  });
  handle("testNotification", () => {
    store.notice(
      uid("test", String(Date.now())),
      "课期通知测试",
      "如果你看到了这条通知，桌面提醒通道可以显示。请点击返回课期。",
    );
    dispatchNotices();
    changed();
  });
  handle("openData", () => shell.openPath(root));
  handle("installBrowser", () => {
    if (existsSync(chromium.executablePath())) return;
    throw new Error(
      "未找到配套浏览器，请重新安装完整安装包；开发环境运行 npm run setup:browser。",
    );
  });
  handle("backup", async () => {
    const result = await dialog.showSaveDialog(window, {
      title: "备份课期数据（不含登录凭据）",
      defaultPath: `课期备份-${new Date().toISOString().slice(0, 10)}.sqlite`,
      filters: [{ name: "SQLite数据库", extensions: ["sqlite"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await store.backup(result.filePath);
    return result.filePath;
  });
  handle("restore", async () => {
    if (workers.size) throw new Error("请等待同步完成后恢复备份");
    const result = await dialog.showOpenDialog(window, {
      title: "选择要恢复的课期备份",
      filters: [{ name: "SQLite数据库", extensions: ["sqlite"] }],
      properties: ["openFile"],
    });
    if (result.canceled) return;
    const candidate = new Database(result.filePaths[0], {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (
        candidate.pragma("integrity_check", { simple: true }) !== "ok" ||
        (
          candidate
            .prepare("SELECT value FROM meta WHERE key='schema'")
            .get() as any
        )?.value !== "1"
      )
        throw new Error("备份文件无效或版本不兼容");
    } finally {
      candidate.close();
    }
    const confirm = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["取消", "恢复备份"],
      defaultId: 0,
      cancelId: 0,
      message: "恢复备份将替换当前任务和设置",
      detail:
        "备份之后的修改不会包含在恢复结果中。恢复前会自动保留当前数据库副本；登录状态不受影响。",
    });
    if (confirm.response !== 1) return;
    // Dialogs yield to the scheduler: recheck immediately before taking the lock.
    if (workers.size || integrations.busy)
      throw new Error("同步或AI请求正在进行，请完成后重试恢复");
    restoring = true;
    const original = join(root, "reminder.sqlite");
    const retained = join(root, "backups", `replaced-${Date.now()}.sqlite`);
    try {
      await integrations.close();
      mkdirSync(join(root, "backups"), { recursive: true });
      await store.backup(
        join(root, "backups", `before-restore-${Date.now()}.sqlite`),
      );
      const staged = join(root, "restored.sqlite");
      copyFileSync(result.filePaths[0], staged);
      store.close();
      // The old database is retained under a new name, never recursively removed.
      renameSync(original, retained);
      renameSync(staged, original);
      app.relaunch();
      app.quit();
    } catch (error) {
      // Reopen the retained database if replacement failed; never discard it.
      if (!existsSync(original) && existsSync(retained))
        renameSync(retained, original);
      app.relaunch();
      app.quit();
      throw error;
    }
  });
}
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.on("before-quit", () => {
  quitting = true;
  clearInterval(timer);
  for (const child of workers.values()) child.kill();
  void integrations?.close();
  store?.close();
});
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    store = new Store(join(root, "reminder.sqlite"));
    integrations = new Integrations(
      store,
      new SecretVault(root),
      () => syncAll(),
      changed,
      () => store.snapshot([...workers.keys()], app.getVersion()),
    );
    await integrations.initialize();
    if (testMode && process.env.REMINDER_FIXTURE)
      store.merge(
        JSON.parse(readFileSync(process.env.REMINDER_FIXTURE, "utf8")),
      );
    window = new BrowserWindow({
      width: 1320,
      height: 880,
      minWidth: 900,
      minHeight: 640,
      title: "课期 · 学业任务提醒",
      backgroundColor: "#f6f8fc",
      icon: join(assets, "icon.png"),
      show: !process.argv.includes("--background"),
      webPreferences: {
        preload: join(here, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setMenuBarVisibility(false);
    window.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (
        !url.startsWith("file:") &&
        !url.startsWith(
          process.env.ELECTRON_RENDERER_URL || "http://localhost:",
        )
      )
        event.preventDefault();
    });
    const icon = nativeImage.createFromPath(join(assets, "icon.png"));
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.on("double-click", () => window.show());
    wireIPC();
    if (process.env.ELECTRON_RENDERER_URL)
      await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else await window.loadFile(join(here, "../renderer/index.html"));
    if (process.platform === "win32") {
      Notification.handleActivation((details) => {
        if (details.type === "click" || details.type === "action")
          navigateNotices();
      });
    }
    window.webContents.on("render-process-gone", (_, details) =>
      failure(`界面进程中断：${details.reason}`),
    );
    powerMonitor.on("resume", () => {
      tick();
    });
    if (!testMode) {
      timer = setInterval(tick, 30000);
      setTimeout(tick, 2000);
    }
    updateTray();
  })
  .catch((error) => {
    dialog.showErrorBox("课期启动失败", redactError(error));
    app.quit();
  });
