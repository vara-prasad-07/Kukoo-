export type Priority = 1 | 2 | 3; // 1 = highest

export type TaskStatus = "open" | "done" | "deferred";

export interface Task {
  id: string;
  title: string;
  /** ISO datetime the task is due. Null = someday / no deadline. */
  deadline: string | null;
  /** Estimated effort in minutes. Drives time-boxing. */
  durationMin: number;
  priority: Priority;
  status: TaskStatus;
  notes?: string;
  createdAt: string;
}

/** A fixed commitment the planner must schedule around. */
export interface BusyBlock {
  id: string;
  title: string;
  start: string;
  end: string;
}

/** A mutation the task engine actually applied. Drives the live board animation. */
export interface TaskOp {
  kind: "add" | "complete" | "reschedule" | "priority" | "delete" | "defer";
  taskId: string;
  title: string;
  /** Human-readable one-liner shown on the activity rail. */
  summary: string;
  before?: Partial<Task>;
  after?: Partial<Task>;
}

export interface ScheduledBlock {
  taskId: string;
  title: string;
  start: string;
  end: string;
  /** True when this block is a continuation of a split task. */
  continuation: boolean;
}

export interface PlanConflict {
  taskId: string;
  title: string;
  reason: string;
  shortfallMin: number;
}

export interface PlanResult {
  blocks: ScheduledBlock[];
  conflicts: PlanConflict[];
  /** Step-by-step record of what the algorithm did, shown in the laptop panel. */
  trace: string[];
  horizonStart: string;
  horizonEnd: string;
  utilizationPct: number;
}

export type Route = "on-device" | "laptop";

export interface AgentTrace {
  agent: string;
  model: string;
  route: Route;
  ms: number;
  detail?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TurnResponse {
  reply: string;
  ops: TaskOp[];
  tasks: Task[];
  route: Route;
  plan: PlanResult | null;
  trace: AgentTrace[];
  endCall: boolean;
}
