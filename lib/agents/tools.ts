import type { ToolDef } from "../groq";
import {
  addTask,
  completeTask,
  deferTask,
  deleteTask,
  describeTasks,
  rescheduleTask,
  setPriority,
} from "../taskEngine";
import type { Task, TaskOp } from "../types";

/**
 * The dialogue agent's entire surface area for changing state. Anything it wants
 * to do to the list it must do through one of these; there is no free-text path
 * from the model to the task store.
 */
export const TASK_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "Read back the current task list. Use when the user asks what's on their list, what's due, what's left, or what to do next.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description: "Optional: 'open', 'done', 'today', or 'all'. Defaults to open.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Add a new task to the list. Use when the user mentions something new they need to do.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title, e.g. 'Reply to Priya'." },
          when: {
            type: "string",
            description:
              "When it is due. ISO 8601 preferred, but natural language like 'tomorrow 2pm' is accepted. Omit if the user gave no time.",
          },
          durationMin: { type: "number", description: "Estimated minutes of effort. Default 30." },
          priority: { type: "number", description: "1 = highest, 2 = normal, 3 = low." },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Mark an existing task as done.",
      parameters: {
        type: "object",
        properties: { task: { type: "string", description: "Task id or title." } },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_task",
      description: "Move a task to a different time or day.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task id or title." },
          when: { type: "string", description: "New time. ISO 8601 or natural language." },
        },
        required: ["task", "when"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_priority",
      description: "Change how important a task is.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task id or title." },
          priority: { type: "number", description: "1 = highest, 2 = normal, 3 = low." },
        },
        required: ["task", "priority"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "defer_task",
      description: "Take a task off today's plan without deleting it.",
      parameters: {
        type: "object",
        properties: { task: { type: "string", description: "Task id or title." } },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Remove a task entirely. Only when the user clearly wants it gone.",
      parameters: {
        type: "object",
        properties: { task: { type: "string", description: "Task id or title." } },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_replan",
      description:
        "Hand off to the heavier planner on the laptop to recompute an optimal time-boxed schedule for multiple tasks at once. Use ONLY when the user wants the day RESTRUCTURED: 'replan my afternoon', 'reorganise my day', 'fit everything in', 'what order should I do these in'. Do NOT use it to answer a question about the list — 'what's left', 'what's due', 'read me my tasks' are answered directly from the list you already have. Do NOT use it for a single reschedule.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description: "What the user asked to replan, e.g. 'afternoon' or 'rest of today'.",
          },
        },
        required: ["scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description: "Hang up. Use when the user says bye, thanks that's all, or similar.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export interface DispatchResult {
  tasks: Task[];
  ops: TaskOp[];
  /** Fed back to the model as the tool result. */
  message: string;
  replanRequested: boolean;
  replanScope?: string;
  endCall: boolean;
}

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
const num = (a: Args, k: string) => (typeof a[k] === "number" ? (a[k] as number) : undefined);

const READ_INTENT =
  /^\s*(what|which|when|how|who|why|read|list|show|tell|give|go through|run through|walk me|anything|do i|is there|are there|remind me what)\b/i;
const ADD_INTENT =
  /\b(add|create|new task|schedule a|put .* on|remind me to|i need to|i have to|i should|don'?t let me forget)\b/i;

/**
 * True when the user asked to HEAR their list rather than change it.
 *
 * A small model reliably mistakes "read them back to me" for a new task called
 * "Read them back to me". Prompting did not fix it, and it shouldn't have to:
 * the engine owns state, so the engine refuses the write. The model gets the
 * refusal as a tool result and answers properly on the next round.
 */
export function isReadRequest(userText: string): boolean {
  if (!userText) return false;
  return READ_INTENT.test(userText) && !ADD_INTENT.test(userText);
}

/** Apply one model tool-call to the task list. Never throws on bad args. */
export function dispatchTool(
  name: string,
  args: Args,
  tasks: Task[],
  now: Date,
  userText = "",
): DispatchResult {
  const base = { tasks, ops: [] as TaskOp[], replanRequested: false, endCall: false };

  switch (name) {
    // Models reach for a read tool under several plausible names. Accepting the
    // aliases is free and avoids a turn dying over a naming guess.
    case "list_tasks":
    case "read_tasks":
    case "get_tasks":
    case "show_tasks":
    case "view_tasks":
    case "get_task_list":
      return { ...base, message: describeTasks(tasks) };
    case "add_task": {
      if (isReadRequest(userText)) {
        return {
          ...base,
          message: `Rejected: the user asked to hear their list, not to add anything. Nothing was added. Answer them directly from this list:\n${describeTasks(tasks)}`,
        };
      }
      const r = addTask(
        tasks,
        { title: str(args, "title"), when: str(args, "when"), durationMin: num(args, "durationMin"), priority: num(args, "priority") },
        now,
      );
      return { ...base, tasks: r.tasks, ops: r.op ? [r.op] : [], message: r.message };
    }
    case "complete_task": {
      const r = completeTask(tasks, str(args, "task") || str(args, "id") || str(args, "title"));
      return { ...base, tasks: r.tasks, ops: r.op ? [r.op] : [], message: r.message };
    }
    case "reschedule_task": {
      const r = rescheduleTask(tasks, str(args, "task") || str(args, "id"), str(args, "when"), now);
      return { ...base, tasks: r.tasks, ops: r.op ? [r.op] : [], message: r.message };
    }
    case "set_priority": {
      const r = setPriority(tasks, str(args, "task") || str(args, "id"), num(args, "priority") ?? 2);
      return { ...base, tasks: r.tasks, ops: r.op ? [r.op] : [], message: r.message };
    }
    case "defer_task": {
      const r = deferTask(tasks, str(args, "task") || str(args, "id"));
      return { ...base, tasks: r.tasks, ops: r.op ? [r.op] : [], message: r.message };
    }
    case "delete_task": {
      const r = deleteTask(tasks, str(args, "task") || str(args, "id"));
      return { ...base, tasks: r.tasks, ops: r.op ? [r.op] : [], message: r.message };
    }
    case "request_replan":
      return {
        ...base,
        replanRequested: true,
        replanScope: str(args, "scope") || "the rest of today",
        message: "Handed off to the laptop planner. The computed schedule will be supplied next.",
      };
    case "end_call":
      return { ...base, endCall: true, message: "Call ending." };
    default:
      return { ...base, message: `Unknown tool "${name}". Current list:\n${describeTasks(tasks)}` };
  }
}
