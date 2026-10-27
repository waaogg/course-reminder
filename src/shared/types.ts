import type {
  AIConfig,
  APIConfig,
  IntegrationStatus,
  AIResult,
} from "./integrations";
export type Platform = "xjtu" | "mooc" | "spoc";
export type AuthState =
  "unknown" | "checking" | "ready" | "needs_login" | "error";
export type Submission =
  "unknown" | "not_submitted" | "submitted" | "needs_resubmit" | "not_open";
export interface Course {
  preferredCourseId?: string;
  id: string;
  platform: Platform;
  remoteId: string;
  term: string;
  title: string;
  url: string;
  active: boolean;
  lastSeen?: string;
}
export interface Requirement {
  id: string;
  taskId: string;
  source: "system" | "teacher";
  phase?: "late";
  precision: "date" | "datetime";
  date: string;
  dueAt?: string;
  original: string;
  evidenceUrl: string;
  confidence: "explicit" | "inferred" | "review";
  completed: boolean;
  version: number;
  override?: boolean;
  retired?: boolean;
}
export interface Attachment {
  url: string;
  name: string;
}
export interface Task {
  lateSubmission?: {
    state: "allowed" | "closed" | "unknown";
    evidence: string;
    observedAt: string;
    url: string;
  };
  alternateSources?: {
    taskId: string;
    courseId: string;
    url: string;
    submission: Submission;
    locallyCompleted?: boolean;
  }[];
  id: string;
  courseId: string;
  title: string;
  kind: "assignment" | "quiz" | "exam" | "peer_review" | "announcement";
  url: string;
  submission: Submission;
  submissionEvidence: string;
  body: string;
  requirements: Requirement[];
  attachments: Attachment[];
  detailRead: boolean;
  updatedAt: string;
  hidden?: boolean;
}
export interface Coverage {
  courseId: string;
  section: string;
  status: "success" | "partial" | "error";
  count: number;
  message: string;
  at: string;
}
export interface ScanResult {
  platform: "xjtu" | "icourse";
  courses: Course[];
  tasks: Task[];
  coverage: Coverage[];
  error?: string;
  needsLogin?: boolean;
}
export interface Account {
  platform: "xjtu" | "icourse";
  state: AuthState;
  lastAttempt?: string;
  lastSuccess?: string;
  error?: string;
}
export interface Settings {
  intervalMinutes: number;
  autoStart: boolean;
  quietStart: number;
  quietEnd: number;
  quietUrgent: boolean;
  notifications: boolean;
  scanAttachments: boolean;
}
export interface Notice {
  id: string;
  requirementId?: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  delivered: boolean;
  taskId?: string;
  status: string;
}
export interface DocumentRecord {
  id: string;
  taskId: string;
  name: string;
  url: string;
  hash?: string;
  status: "pending" | "success" | "partial" | "unsupported" | "error";
  message: string;
  text?: string;
  at: string;
}
export interface Snapshot {
  courses: Course[];
  tasks: Task[];
  accounts: Account[];
  coverage: Coverage[];
  notices: Notice[];
  documents: DocumentRecord[];
  settings: Settings;
  busy: string[];
  nextSync: string;
  version: string;
}
export interface DesktopAPI {
  configuration(): Promise<IntegrationStatus>;
  saveAI(config: AIConfig, key?: string): Promise<IntegrationStatus>;
  saveAPI(config: APIConfig): Promise<IntegrationStatus>;
  copyAPIToken(): Promise<void>;
  rotateAPIToken(): Promise<void>;
  analyzeTask(id: string): Promise<AIResult>;
  testAI(): Promise<AIResult>;
  diagnostics?(): Promise<{ text: string; browserOK: boolean }>;
  snapshot(): Promise<Snapshot>;
  sync(): Promise<void>;
  login(platform: "xjtu" | "icourse"): Promise<void>;
  finishLogin(platform: "xjtu" | "icourse"): Promise<void>;
  complete(id: string, completed: boolean): Promise<void>;
  correct(id: string, value: string): Promise<void>;
  readNotice(id: string): Promise<void>;
  snooze(id: string): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  open(url: string): Promise<void>;
  testNotification(): Promise<void>;
  backup(): Promise<string | null>;
  restore(): Promise<void>;
  openData(): Promise<void>;
  installBrowser(): Promise<void>;
  onChanged(fn: () => void): () => void;
  onNavigateNotices(fn: () => void): () => void;
}
declare global {
  interface Window {
    reminder: DesktopAPI;
  }
}
