import type { CompanionMemoryState } from "./companion-memory";
import type { RoutineBoard, TaskBoard } from "./foundations-types";
import type { SkillLibrary } from "./learned-skills";
export type Page =
  | "home"
  | "projects"
  | "assistant"
  | "boards"
  | "routines"
  | "clock"
  | "agent-office"
  | "core-memory"
  | "skills"
  | "delivery"
  | "project-setup"
  | "browser"
  | "monitoring"
  | "self-maintenance"
  | "agents"
  | "usage"
  | "devices"
  | "connections"
  | "activity"
  | "settings";
export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  updatedAt: string;
  status: string;
  pinned?: boolean;
}
export interface Device {
  id: string;
  name: string;
  platform: string;
  pairedAt: string;
  lastSeen?: string;
  capabilities?: string[];
  permissions?: {
    projectAccess: boolean;
    googleAccess: boolean;
    browserControl: boolean;
    remoteDesktop?: boolean;
  };
}
export interface Provider {
  id: string;
  name: string;
  status: string;
  connectionType: string;
  models: (string | { id: string; name?: string })[];
  selectedModel: string;
  effort: string;
  usageCreditsDisabledConfirmed?: boolean;
  detail?: string;
  modelDetails?: {
    id: string;
    name: string;
    efforts: string[];
    defaultEffort: string;
    isDefault?: boolean;
  }[];
}
export interface AiRole {
  providerId: "codex" | "claude";
  model: string;
  effort: string;
}
export interface AiRoles {
  planning: AiRole;
  development: AiRole;
  chat: AiRole;
  research: AiRole;
  imagePrompts: AiRole;
  tasks: { general: AiRole; technical: AiRole };
}
export interface ProjectTeam {
  peer: AiRole;
  maxFixCycles: number;
}
export interface ProjectWorkflow {
  id: string;
  projectId: string;
  status: string;
  stage: string;
  message: string;
  assignments: { manager: AiRole; peer: AiRole; development: AiRole };
  taskIds: string[];
  questions: { id: string; text: string; source?: string; answer?: string }[];
  plan?: string;
  workItems?: {
    id?: string;
    title: string;
    instructions?: string;
    files?: string[];
    status?: string;
  }[];
  reviews?: {
    role?: string;
    round?: number;
    verdict?: string;
    summary?: string;
    findings?: string[];
  }[];
  checkApprovalId?: string;
  checkSummary?: string;
  checkReceipts?: {
    checkName: string;
    round: number;
    approvalId: string;
    taskId?: string;
    status: string;
    exitCode?: number | null;
    signal?: string | null;
    output?: string;
    error?: string;
    createdAt: string;
    finishedAt?: string;
  }[];
  reviewRound: number;
  error?: string;
  detail?: string;
  createdAt: string;
  updatedAt?: string;
}
export interface Task {
  id: string;
  projectId?: string;
  providerId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  output?: string;
  error?: string;
  kind?: string;
  checkName?: string;
  manifestHash?: string;
  exitCode?: number | null;
  signal?: string | null;
  routingReason?: string;
  routingRole?: string;
  selectedModel?: string;
  requestedEffort?: string;
  effectiveEffort?: string;
  effortDetail?: string;
}
export interface Approval {
  id: string;
  type: string;
  title: string;
  description: string;
  createdAt: string;
  status: string;
  error?: string;
  result?: { taskId?: string; status?: string; [key: string]: unknown };
}
export interface CheckRepair {
  id: string;
  projectId: string;
  sourceTaskId: string;
  checkName: string;
  providerId: string;
  model: string;
  effort: string;
  requestedBy: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  buildTaskId: string | null;
  approvalId: string | null;
  checkTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  detail: string;
}
export interface Connection {
  id: string;
  name: string;
  category?: string;
  status: string;
  accountLabel?: string;
  detail?: string;
  accounts?: { id: string; accountLabel: string; status: string }[];
}
export interface GoogleAccount {
  id: string;
  label: string;
  email: string;
  services: string[];
  status: string;
  connectedAt: string;
}
export interface ChatRecord {
  id: string;
  revision: number;
  projectId?: string | null;
  deliveryDeviceId: string;
  status: "active" | "archived" | "completed";
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  summary: string;
  summaryMethod: "local_extract";
  canComplete: boolean;
}
export interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  projectId?: string;
  localOutcome?: { type: string; url?: string };
  chatId?: string;
  deliveryOnly?: boolean;
}
export interface AppState {
  projectIntakes?: import("./project-setup").ProjectIntake[];
  browserStudio?: import("./browser-studio").BrowserStudioState;
  skillLibrary?: SkillLibrary;
  config: {
    interactionRole?: AiRole;
    aiRoles?: AiRoles;
    projectTeam?: ProjectTeam;
    companionLearningEnabled?: boolean;
    fastReplies?: boolean;
    remoteDesktopEnabled?: boolean;
    workspaceRoot: string;
    hostName: string;
    allowLan: boolean;
    vpnOnly?: boolean;
    port: number;
    voice: string;
    confirmOrdinaryActions: boolean;
    memoryEnabled?: boolean;
    closeToTray?: boolean;
    startWithWindows?: boolean;
  };
  projects: Project[];
  devices: Device[];
  providers: Provider[];
  tasks: Task[];
  approvals: Approval[];
  connections: Connection[];
  messages: Message[];
  chatHistory?: { rotationHours: number; chats: ChatRecord[] };
  googleAccounts?: GoogleAccount[];
  checkRepairs?: CheckRepair[];
  projectWorkflows?: ProjectWorkflow[];
  agentOffice?: { version: number; agents: AgentOfficeAgent[] };
  companionMemory?: CompanionMemoryState;
  taskBoard?: TaskBoard;
  routineBoard?: RoutineBoard;
  alarmSounds?: import("./foundations-types").AlarmSound[];
  deviceLocations?: {
    deviceId: string;
    enabled: boolean;
    updatedAt?: string;
    lastKnown?: {
      latitude: number;
      longitude: number;
      accuracy: number;
      observedAt: string;
      receivedAt: string;
    };
  }[];
}
export interface AgentOfficeAgent {
  id: string;
  name: string;
  providerId: string;
  role: string;
  parentId?: string;
  taskId?: string;
  workflowId?: string;
  projectId?: string;
  sourceKind: "workflow" | "task";
  receiptKind?: "workflow_orchestration" | "model_task" | "tool_task";
  title: string;
  status: string;
  phase?: string;
  summary?: string;
  output?: string;
  outputTruncated?: boolean;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  model?: string;
  requestedEffort?: string;
  effectiveEffort?: string;
}
export interface FileEntry {
  name: string;
  path: string;
  type?: string;
  isDirectory?: boolean;
  size?: number;
}
export interface PairingTicket {
  ticket: string;
  expiresAt: string;
  port: number;
  fingerprint: string;
  hostName: string;
}
declare global {
  interface Window {
    nakama?: {
      api: <T = unknown>(
        method: string,
        path: string,
        body?: unknown,
      ) => Promise<T>;
      chooseFolder: () => Promise<string | null>;
      openProjectFolder: (projectId: string) => Promise<void>;
      saveProjectReport: (
        projectId: string,
        reportId: string,
      ) => Promise<{ saved: boolean }>;
      openProjectReport: (
        projectId: string,
        reportId: string,
      ) => Promise<{ opened: boolean }>;
      copyText: (text: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onEvent: (callback: (event: unknown) => void) => () => void;
    };
  }
}
