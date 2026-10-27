import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  ListTodo,
  BookOpen,
  Bell,
  Settings as SettingsIcon,
  RefreshCw,
  ArrowUpRight,
  Check,
  X,
  Clock3,
  AlertTriangle,
  ChevronRight,
  LogIn,
  Download,
  FolderOpen,
  Search,
  FileText,
  ShieldCheck,
  CircleHelp,
  CheckCircle2,
} from "lucide-react";
import type { Snapshot, Task, Requirement, Settings } from "../../shared/types";
import "./style.css";
import { IntegrationSettings, TaskAI } from "./integrations";
import {
  isRequirementOverdue,
  taskFullyCompleted as finished,
  taskSubmittedOrCompleted,
  needsTeacherAction,
  isOverdueUnsubmitted,
  taskSubmissionLabel,
} from "../../domain/tasks";
const overdue = (r: Requirement) => isRequirementOverdue(r);
const platformNames = {
  xjtu: "思源学堂",
  mooc: "中国大学 MOOC",
  spoc: "MOOC · SPOC",
};
const statusNames = {
  unknown: "待核实",
  not_submitted: "未提交",
  submitted: "已提交",
  needs_resubmit: "需重新提交",
  not_open: "尚未开放",
};
const api = window.reminder;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function dateText(r: Requirement) {
  return `${r.date.slice(5).replace("-", "月")}日${r.dueAt ? " " + new Date(r.dueAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }) : " · 未注明时刻"}`;
}
function ago(at?: string) {
  if (!at) return "尚未同步";
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000));
  return min < 1
    ? "刚刚"
    : min < 60
      ? `${min} 分钟前`
      : `${Math.floor(min / 60)} 小时前`;
}
function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [page, setPage] = useState("tasks"),
    [filter, setFilter] = useState("pending"),
    [search, setSearch] = useState(""),
    [courseFilter, setCourseFilter] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const refresh = async () => {
    try {
      setData(await api.snapshot());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    refresh();
    const off = api.onChanged(refresh);
    const offNavigate = api.onNavigateNotices(() => {
      setSelected(null);
      setPage("notices");
    });
    const timer = setInterval(refresh, 30000);
    return () => {
      off();
      offNavigate();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (selected) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [selected]);
  async function action(work: () => Promise<unknown>, message = "") {
    setError("");
    try {
      await work();
      if (message) {
        setSuccess(message);
        setTimeout(() => setSuccess(""), 5000);
      }
      await refresh();
    } catch (e) {
      setError(
        String(e).replace(
          /^Error: Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    }
  }
  const courses = useMemo(
    () => new Map((data?.courses || []).map((c) => [c.id, c])),
    [data?.courses],
  );
  const tasks = data?.tasks || [],
    selectedTask = tasks.find((t) => t.id === selected);
  const pairedCourses = new Map(
    (data?.courses || [])
      .filter((c) => c.preferredCourseId)
      .map((c) => [c.id, c.preferredCourseId!]),
  );
  const upcoming = tasks.filter(
    (t) =>
      !finished(t) && t.requirements.some((r) => !r.completed && !overdue(r)),
  ).length;
  const review = tasks.filter(
    (t) =>
      t.requirements.some((r) => r.confidence !== "explicit") ||
      !t.detailRead ||
      data?.documents.some((d) => d.taskId === t.id && d.status !== "success"),
  ).length;
  const visible = tasks
    .filter((t) => {
      if (
        courseFilter &&
        t.courseId !== courseFilter &&
        pairedCourses.get(t.courseId) !== courseFilter
      )
        return false;
      if (
        search &&
        !`${t.title} ${courses.get(t.courseId)?.title}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        return false;
      if (filter === "done") return taskSubmittedOrCompleted(t);
      if (filter === "all") return true;
      if (filter === "teacher") return needsTeacherAction(t);
      if (filter === "overdue") return isOverdueUnsubmitted(t);
      if (finished(t)) return false;
      if (filter === "today")
        return t.requirements.some((r) => !r.completed && r.date === today());
      if (filter === "week") {
        const end = new Date(Date.now() + 7 * 86400000)
          .toISOString()
          .slice(0, 10);
        return t.requirements.some(
          (r) => !r.completed && r.date >= today() && r.date <= end,
        );
      }
      if (filter === "review")
        return (
          !t.detailRead ||
          t.requirements.some((r) => r.confidence !== "explicit") ||
          data?.documents.some(
            (d) => d.taskId === t.id && d.status !== "success",
          )
        );
      return (
        !taskSubmittedOrCompleted(t) &&
        !isOverdueUnsubmitted(t) &&
        (t.kind !== "announcement" || t.requirements.length > 0)
      );
    })
    .sort((a, b) => {
      const key = (t: Task) =>
        t.requirements
          .filter((r) => !r.completed)
          .map((r) => r.date)
          .sort()[0] || "9999";
      return key(a).localeCompare(key(b));
    });
  if (!data)
    return (
      <div className="startup">
        <CalendarDays size={40} />
        <h1>课期</h1>
        <p>{error || "正在读取本地课程与提醒…"}</p>
      </div>
    );
  const busy = data.busy.length > 0,
    unread = data.notices.filter(
      (n) => !n.read && n.status !== "superseded",
    ).length;
  const onSettings = (update: Partial<Settings>) =>
    action(() => api.saveSettings({ ...data.settings, ...update }));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <CalendarDays size={23} />
          </div>
          <span>
            课期<small>学业任务提醒</small>
          </span>
        </div>
        <nav aria-label="主导航">
          {[
            { id: "tasks", icon: ListTodo, label: "任务与期限" },
            { id: "courses", icon: BookOpen, label: "课程与采集" },
            { id: "notices", icon: Bell, label: "通知中心" },
            { id: "settings", icon: SettingsIcon, label: "设置" },
          ].map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "notices" && unread > 0 && (
                <b className="nav-count">{unread}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <ShieldCheck size={16} />
            数据保存在这台电脑
          </div>
          <p>
            关掉主窗口，继续后台提醒。
            <br />
            从托盘退出后暂停运行。
          </p>
          <span className="version">课期 v{data.version}</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            {new Date().toLocaleDateString("zh-CN", {
              timeZone: "Asia/Shanghai",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </span>
          <div className="topbar-actions">
            <span className={`sync-state ${busy ? "working" : ""}`}>
              <i />
              {busy
                ? "正在自动采集"
                : "每 " + data.settings.intervalMinutes + " 分钟自动同步"}
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => action(() => api.sync())}
            >
              <RefreshCw size={15} className={busy ? "spinning" : ""} />
              {busy ? "同步中" : "立即同步"}
            </button>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="banner error" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button aria-label="关闭错误提示" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {success && (
            <div className="banner success" role="status">
              <CheckCircle2 size={18} />
              {success}
            </div>
          )}
          {data.accounts.some(
            (a) => a.state === "needs_login" || a.state === "unknown",
          ) && (
            <div className="banner setup">
              <LogIn size={19} />
              <div>
                <strong>连接课程平台，开始自动采集</strong>
                <span>请在专用浏览器中登录，之后无需逐门打开课程。</span>
              </div>
              <button
                className="button secondary"
                onClick={() => setPage("courses")}
              >
                连接平台
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {page === "tasks" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="heading-kicker">课程安排，心中有数</span>
                  <h1>任务与期限</h1>
                  <p>老师要求日期与系统截止时间，分别记清。</p>
                </div>
                <div className="heading-note">
                  <span className="note-dot" />
                  <span>
                    {upcoming} 项有后续期限
                    <br />
                    <small>{review} 项需要核对</small>
                  </span>
                </div>
              </div>
              <div className="toolbar">
                <div className="tabs" role="tablist" aria-label="任务筛选">
                  {[
                    ["pending", "待处理"],
                    ["today", "今天"],
                    ["week", "未来七天"],
                    ["overdue", "逾期未提交"],
                    ["teacher", "老师待办"],
                    ["review", "待核对"],
                    ["done", "已完成"],
                    ["all", "全部"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={filter === id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="搜索课程或任务"
                    placeholder="搜索课程或任务"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="list-caption">
                <span>{visible.length} 项任务</span>
                <select
                  aria-label="按课程筛选"
                  value={courseFilter}
                  onChange={(e) => setCourseFilter(e.target.value)}
                >
                  <option value="">全部课程</option>
                  {data.courses
                    .filter((c) => !pairedCourses.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} · {platformNames[c.platform]}
                      </option>
                    ))}
                </select>
              </div>
              <div className="task-list">
                {visible.map((task) => {
                  const course = courses.get(task.courseId),
                    teacher = task.requirements.filter(
                      (r) => r.source === "teacher",
                    ),
                    system = task.requirements.filter(
                      (r) => r.source === "system" && !r.phase,
                    ),
                    conflict = teacher.some((a) =>
                      system.some((b) => a.date !== b.date),
                    );
                  return (
                    <button
                      className={`task-card ${finished(task) ? "finished" : ""}`}
                      key={task.id}
                      onClick={() => {
                        setSelected(task.id);
                        setEdit(null);
                      }}
                    >
                      <div className="task-topline">
                        <span className="course-label">
                          {course?.title || "课程"}
                        </span>
                        <span className="platform-label">
                          {course ? platformNames[course.platform] : ""}
                        </span>
                        <span
                          className={`submission ${task.submission === "submitted" ? "submitted" : ""}`}
                        >
                          {taskSubmissionLabel(task)}
                        </span>
                      </div>
                      <div className="task-title-row">
                        <h2>{task.title}</h2>
                        <ChevronRight size={19} />
                      </div>
                      {!!task.alternateSources?.length && (
                        <small>
                          SPOC优先 · 已折叠{task.alternateSources.length}
                          个重复MOOC来源
                        </small>
                      )}
                      <div className="deadline-pair">
                        <div className="deadline teacher">
                          <span className="deadline-label">老师要求</span>
                          <strong>
                            {teacher.length
                              ? dateText(teacher[0])
                              : task.detailRead
                                ? "无"
                                : "尚未检查"}
                          </strong>
                          {teacher.length > 1 && (
                            <small>另有 {teacher.length - 1} 项要求</small>
                          )}
                          {teacher.some((r) => r.confidence !== "explicit") && (
                            <span className="candidate">请核对</span>
                          )}
                        </div>
                        <div className="deadline system">
                          <span className="deadline-label">系统截止</span>
                          <strong>
                            {system.length
                              ? dateText(system[0])
                              : "无"}
                          </strong>
                        </div>
                      </div>
                      {task.requirements
                        .filter((r) => r.phase === "late")
                        .map((r) => (
                          <small key={r.id}>补交截止：{dateText(r)}</small>
                        ))}
                      <div className="task-foot">
                        {conflict ? (
                          <span className="conflict">
                            <AlertTriangle size={13} />
                            两类日期不一致，分别提醒
                          </span>
                        ) : (
                          <span>
                            {task.kind === "announcement"
                              ? "课程公告"
                              : task.kind === "exam"
                                ? "课程考试"
                                : task.kind === "peer_review"
                                  ? "学生互评"
                                  : "课程任务"}
                          </span>
                        )}
                        <span>{ago(task.updatedAt)}核对</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!visible.length && (
                <div className="empty">
                  <CalendarDays size={44} />
                  <h2>
                    {tasks.length ? "这个分类暂时没有任务" : "还没有课程任务"}
                  </h2>
                  <p>
                    {tasks.length
                      ? "可以切换分类或查看其他课程。"
                      : "先连接两个平台。完成登录后，课期会自动读取你的课程与任务。"}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => {
                      setPage("courses");
                    }}
                  >
                    查看课程与采集
                  </button>
                </div>
              )}
            </>
          )}
          {page === "courses" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="heading-kicker">信息来自你的课程</span>
                  <h1>课程与采集</h1>
                  <p>查看连接状态和每门课程的采集覆盖。</p>
                </div>
                <span className="plain-total">
                  {data.courses.length - pairedCourses.size} 门课程 ·{" "}
                  {data.courses.length} 个来源
                </span>
              </div>
              <div className="account-grid">
                {data.accounts.map((a) => (
                  <section className="account" key={a.platform}>
                    <div className="account-heading">
                      <BookOpen size={22} />
                      <h2>
                        {a.platform === "xjtu" ? "思源学堂" : "中国大学 MOOC"}
                      </h2>
                      <span
                        className={`connection ${a.state === "ready" ? "connected" : ""}`}
                      >
                        {a.state === "ready"
                          ? "已连接"
                          : a.state === "checking"
                            ? "正在处理"
                            : a.state === "needs_login"
                              ? "需要登录"
                              : a.state === "error"
                                ? "需要检查"
                                : "未连接"}
                      </span>
                    </div>
                    <p>
                      {(data as any).progress?.[a.platform] ||
                        a.error ||
                        `最近成功：${ago(a.lastSuccess)}`}
                    </p>
                    <button
                      className="button secondary"
                      disabled={data.busy.includes(a.platform)}
                      onClick={() => action(() => api.login(a.platform))}
                    >
                      <LogIn size={16} />
                      {a.state === "ready" ? "管理登录" : "打开登录窗口"}
                    </button>
                  </section>
                ))}
              </div>
              <div className="section-heading">
                <h2>课程覆盖</h2>
                <span>失败项会保留上次数据，不清空任务</span>
              </div>
              {data.courses
                .filter((c) => !pairedCourses.has(c.id))
                .map((course) => {
                  const coverage = data.coverage.filter(
                    (c) => c.courseId === course.id,
                  );
                  return (
                    <section className="course-row" key={course.id}>
                      <div>
                        <h3>{course.title}</h3>
                        <span>
                          {platformNames[course.platform]}
                          {course.term ? " · " + course.term : ""}
                        </span>
                      </div>
                      <div className="coverage-tags">
                        {coverage.length ? (
                          coverage.map((c) => (
                            <span
                              title={c.message || ago(c.at)}
                              key={c.section}
                              className={c.status === "success" ? "ok" : "warn"}
                            >
                              {c.status === "success" ? (
                                <Check size={13} />
                              ) : (
                                <AlertTriangle size={13} />
                              )}
                              {{
                                homework: "作业",
                                exam: "测试",
                                bulletin: "公告",
                                assessments: "测验与考试",
                                announce: "公告",
                              }[c.section] || c.section}
                              {c.status === "success"
                                ? ` ${c.count}`
                                : " · 未读完"}
                            </span>
                          ))
                        ) : (
                          <span>等待采集</span>
                        )}
                      </div>
                      {coverage
                        .filter((c) => c.status !== "success")
                        .map((c) => (
                          <p className="coverage-error" key={c.section}>
                            {c.message}
                          </p>
                        ))}
                      {[...pairedCourses].some(
                        ([, primary]) => primary === course.id,
                      ) && (
                        <details className="duplicate-course">
                          <summary>
                            已折叠MOOC重复课程 · 相同任务优先SPOC，独有内容保留
                          </summary>
                          {data.courses
                            .filter(
                              (c) => pairedCourses.get(c.id) === course.id,
                            )
                            .map((source) => (
                              <div key={source.id}>
                                <strong>{source.title} · MOOC来源</strong>
                                <div className="coverage-tags">
                                  {data.coverage
                                    .filter((c) => c.courseId === source.id)
                                    .map((c) => (
                                      <span
                                        key={c.section}
                                        className={
                                          c.status === "success" ? "ok" : "warn"
                                        }
                                        title={c.message || ago(c.at)}
                                      >
                                        {(
                                          {
                                            assessments: "测验与作业",
                                            exams: "考试",
                                            announce: "公告",
                                          } as Record<string, string>
                                        )[c.section] || c.section}{" "}
                                        ·{" "}
                                        {c.status === "success"
                                          ? c.count
                                          : "未读完"}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            ))}
                        </details>
                      )}
                    </section>
                  );
                })}
              {!data.courses.length && (
                <div className="empty compact">
                  <BookOpen size={36} />
                  <p>登录完成后，这里会显示自动发现的课程。</p>
                </div>
              )}
            </>
          )}
          {page === "notices" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="heading-kicker">需要留意的事</span>
                  <h1>通知中心</h1>
                  <p>提醒会保存在这里，直到你处理它们。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() =>
                    action(
                      () => api.testNotification(),
                      "已创建测试提醒，请确认桌面通知是否可见",
                    )
                  }
                >
                  测试桌面通知
                </button>
              </div>
              <div className="notices">
                {data.notices.map((n) => (
                  <article
                    className={`notice ${n.read ? "read" : ""}`}
                    key={n.id}
                  >
                    <div className="notice-symbol">
                      <Bell size={19} />
                    </div>
                    <div className="notice-body">
                      <h2>{n.title}</h2>
                      <p>{n.body}</p>
                      <small>
                        {new Date(n.createdAt).toLocaleString("zh-CN")} ·{" "}
                        {n.status === "superseded"
                          ? "已被新的完成状态或期限替代"
                          : n.status === "uncertain"
                            ? "投递结果未确认，请在此查看"
                            : n.status === "failed"
                              ? "系统通知未显示，请查看本条内容"
                              : n.delivered
                                ? "已请求系统通知"
                                : "已保存，等待桌面提示"}
                      </small>
                      <div className="notice-actions">
                        {n.taskId && (
                          <button onClick={() => setSelected(n.taskId!)}>
                            查看任务
                          </button>
                        )}
                        {!n.read && (
                          <button
                            onClick={() => action(() => api.readNotice(n.id))}
                          >
                            标为已读
                          </button>
                        )}
                        {n.requirementId && (
                          <button
                            onClick={() =>
                              action(
                                () => api.snooze(n.id),
                                "30 分钟后再次提醒",
                              )
                            }
                          >
                            <Clock3 size={13} />
                            稍后提醒
                          </button>
                        )}
                      </div>
                    </div>
                    {!n.read && <i className="unread-dot" />}
                  </article>
                ))}
              </div>
              {!data.notices.length && (
                <div className="empty">
                  <Bell size={42} />
                  <h2>暂时没有提醒</h2>
                  <p>新任务、日期变化和到期提醒会显示在这里。</p>
                </div>
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="heading-kicker">按你的节奏运行</span>
                  <h1>设置</h1>
                  <p>采集、提醒与数据都由你掌握。</p>
                </div>
              </div>
              <section className="settings-section">
                <h2>自动采集</h2>
                <label className="setting-row">
                  <span>
                    <strong>同步间隔</strong>
                    <small>唤醒或网络恢复后，也会补采错过的计划。</small>
                  </span>
                  <select
                    value={data.settings.intervalMinutes}
                    onChange={(e) =>
                      onSettings({ intervalMinutes: Number(e.target.value) })
                    }
                  >
                    {[5, 15, 30, 60, 120].map((n) => (
                      <option key={n} value={n}>
                        每 {n} 分钟
                      </option>
                    ))}
                  </select>
                </label>
                <Toggle
                  title="登录 Windows 后自动启动"
                  description="启动后保持托盘运行，关机或退出时暂停。"
                  value={data.settings.autoStart}
                  change={(v) => onSettings({ autoStart: v })}
                />
                <Toggle
                  title="读取关联附件和图片"
                  description="使用本地文字提取和 OCR；无法处理的文件会明确标记。"
                  value={data.settings.scanAttachments}
                  change={(v) => onSettings({ scanAttachments: v })}
                />
              </section>
              <section className="settings-section">
                <h2>提醒</h2>
                <Toggle
                  title="桌面通知"
                  description="应用内通知中心始终保留提醒。"
                  value={data.settings.notifications}
                  change={(v) => onSettings({ notifications: v })}
                />
                <div className="setting-row">
                  <span>
                    <strong>免打扰时段</strong>
                    <small>
                      时段内保留通知，结束后统一提示；开始结束相同表示关闭。
                    </small>
                  </span>
                  <div className="quiet-inputs">
                    <select
                      aria-label="免打扰开始"
                      value={data.settings.quietStart}
                      onChange={(e) =>
                        onSettings({ quietStart: Number(e.target.value) })
                      }
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {String(i).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                    <span>至</span>
                    <select
                      aria-label="免打扰结束"
                      value={data.settings.quietEnd}
                      onChange={(e) =>
                        onSettings({ quietEnd: Number(e.target.value) })
                      }
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {String(i).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="setting-explanation">
                  明确到时刻：提前 3 天、1 天、3 小时。仅有日期：前一天 20:00
                  和当天 09:00。老师要求与系统截止分别提醒。
                </p>
                <Toggle
                  title="免打扰期间保留临近截止提醒"
                  description="明确截止将在免打扰结束前到来时，仍允许提示。"
                  value={data.settings.quietUrgent}
                  change={(v) => onSettings({ quietUrgent: v })}
                />
                <button
                  className="button secondary"
                  onClick={() =>
                    action(() => api.testNotification(), "已创建测试提醒")
                  }
                >
                  发送测试通知
                </button>
              </section>
              <section className="settings-section">
                <h2>本机数据</h2>
                <p className="setting-explanation">
                  任务与登录状态保存在本机。备份只包含业务数据，不包含登录凭据。
                </p>
                <div className="button-row">
                  <button
                    className="button secondary"
                    onClick={() => action(() => api.backup(), "备份已完成")}
                  >
                    <Download size={15} />
                    导出备份
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => action(() => api.restore())}
                  >
                    恢复备份
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => action(() => api.openData())}
                  >
                    <FolderOpen size={15} />
                    打开数据目录
                  </button>
                </div>
              </section>
              <IntegrationSettings />
            </>
          )}
        </div>
      </main>
      <dialog
        ref={dialogRef}
        className="task-dialog"
        onClose={() => {
          setSelected(null);
          setEdit(null);
        }}
      >
        <div className="dialog-inner">
          {selectedTask && (
            <>
              <button
                className="dialog-close"
                aria-label="关闭任务详情"
                onClick={() => setSelected(null)}
              >
                <X size={22} />
              </button>
              <span className="course-label">
                {courses.get(selectedTask.courseId)?.title}
              </span>
              <h1>{selectedTask.title}</h1>
              <div className="dialog-subline">
                <span>{taskSubmissionLabel(selectedTask)}</span>
                <span>{ago(selectedTask.updatedAt)}核对</span>
                <button
                  onClick={() => action(() => api.open(selectedTask.url))}
                >
                  打开课程平台
                  <ArrowUpRight size={14} />
                </button>
              </div>
              {!!selectedTask.alternateSources?.length && (
                <section className="evidence">
                  <h2>重复来源（优先保留SPOC）</h2>
                  <p>以下MOOC记录已折叠，不重复提醒；提交状态仍分别保留。</p>
                  {selectedTask.alternateSources.map((source) => (
                    <button
                      className="button secondary"
                      key={source.taskId}
                      onClick={() => action(() => api.open(source.url))}
                    >
                      MOOC来源 ·{" "}
                      {source.locallyCompleted
                        ? "已完成"
                        : statusNames[source.submission]}{" "}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </section>
              )}
              {selectedTask.lateSubmission && (
                <section className="source-evidence">
                  <h2>补交情况</h2>
                  <p>
                    {selectedTask.lateSubmission.state === "allowed"
                      ? "平台明确允许补交；原截止时间仍保留。"
                      : selectedTask.lateSubmission.state === "closed"
                        ? "平台明确不可补交。"
                        : selectedTask.detailRead ? "无补交说明" : "补交信息尚未读取"}
                  </p>
                  <p>
                    {selectedTask.lateSubmission.evidence || "无"}
                  </p>
                  <small>
                    读取于{" "}
                    {new Date(
                      selectedTask.lateSubmission.observedAt,
                    ).toLocaleString()}
                  </small>
                </section>
              )}
              <div className="requirements">
                {["teacher", "system"].map((source) => (
                  <section
                    key={source}
                    className={`requirement-group ${source}`}
                  >
                    <h2>
                      {source === "teacher" ? "老师要求日期" : "系统截止时间"}
                    </h2>
                    {selectedTask.requirements
                      .filter((r) => r.source === source)
                      .map((req) => (
                        <div
                          className={`requirement ${req.completed ? "done" : ""}`}
                          key={req.id}
                        >
                          <div>
                            <strong>
                              {req.phase === "late" ? "补交截止 · " : ""}
                              {dateText(req)}
                            </strong>
                            {req.confidence !== "explicit" && (
                              <span className="candidate">
                                {req.confidence === "review"
                                  ? "识别候选，请确认"
                                  : "年份根据上下文推断"}
                              </span>
                            )}
                            <p>{req.original}</p>
                            {req.override && (
                              <span className="candidate">
                                已按你的本地校正
                              </span>
                            )}
                            <button
                              className="evidence-link"
                              onClick={() =>
                                action(() => api.open(req.evidenceUrl))
                              }
                            >
                              查看原始来源
                              <ArrowUpRight size={12} />
                            </button>
                            {overdue(req) && (
                              <small className="overdue">
                                {req.precision === "date"
                                  ? "已过老师要求日期"
                                  : "已过截止时间"}
                              </small>
                            )}
                          </div>
                          <div className="requirement-actions">
                            <button
                              className="button secondary"
                              onClick={() =>
                                action(() =>
                                  api.complete(req.id, !req.completed),
                                )
                              }
                            >
                              {req.completed ? <Check size={15} /> : null}
                              {req.completed ? "已完成 · 撤销" : "标记已完成"}
                            </button>
                            <button
                              onClick={() =>
                                setEdit({
                                  id: req.id,
                                  value:
                                    req.date +
                                    (req.dueAt
                                      ? " " +
                                        new Date(req.dueAt).toLocaleTimeString(
                                          "zh-CN",
                                          {
                                            timeZone: "Asia/Shanghai",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          },
                                        )
                                      : ""),
                                })
                              }
                            >
                              校正日期
                            </button>
                          </div>
                          {edit?.id === req.id && (
                            <form
                              className="date-edit"
                              onSubmit={(e) => {
                                e.preventDefault();
                                action(
                                  () => api.correct(edit.id, edit.value),
                                  "日期已校正",
                                ).then(() => setEdit(null));
                              }}
                            >
                              <label>
                                日期或时间
                                <input
                                  autoFocus
                                  aria-label="校正后的日期"
                                  value={edit.value}
                                  onChange={(e) =>
                                    setEdit({ ...edit, value: e.target.value })
                                  }
                                  placeholder="2026-10-30 或 2026-10-30 23:30"
                                />
                              </label>
                              <button className="button primary" type="submit">
                                保存校正
                              </button>
                            </form>
                          )}
                        </div>
                      ))}
                    {!selectedTask.requirements.some(
                      (r) => r.source === source,
                    ) && (
                      <p className="muted">
                        {selectedTask.detailRead
                          ? "尚未发现明确日期。"
                          : "详情尚未读完，请查看采集状态。"}
                      </p>
                    )}
                  </section>
                ))}
              </div>
              <section className="evidence">
                <h2>来源说明</h2>
                <p className="preformatted">
                  {selectedTask.body || "此任务暂时没有可读取的说明正文。"}
                </p>
              </section>
              {data.documents.filter((d) => d.taskId === selectedTask.id)
                .length > 0 && (
                <section className="evidence">
                  <h2>关联附件</h2>
                  {data.documents
                    .filter((d) => d.taskId === selectedTask.id)
                    .map((d) => (
                      <div className="document-row" key={d.id}>
                        <FileText size={17} />
                        <div>
                          <strong>{d.name}</strong>
                          <p>{d.message}</p>
                          <button
                            className="evidence-link"
                            onClick={() => action(() => api.open(d.url))}
                          >
                            打开原附件
                            <ArrowUpRight size={12} />
                          </button>
                        </div>
                        <span>
                          {d.status === "success"
                            ? "已提取"
                            : d.status === "pending"
                              ? "处理中"
                              : "待检查"}
                        </span>
                      </div>
                    ))}
                </section>
              )}
              <TaskAI taskId={selectedTask.id} onChanged={refresh} />
              <p className="dialog-footnote">
                <CircleHelp size={14} />
                本地标记不会向平台提交作业；老师要求与平台提交状态相互独立。
              </p>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
function Toggle({
  title,
  description,
  value,
  change,
}: {
  title: string;
  description: string;
  value: boolean;
  change: (v: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        className="toggle"
        type="checkbox"
        checked={value}
        onChange={(e) => change(e.target.checked)}
      />
    </label>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
