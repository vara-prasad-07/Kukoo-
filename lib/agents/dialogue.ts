import { chat, MODELS, type GroqMessage } from "../groq";
import { describeCalendar, describeTasks, fmt } from "../taskEngine";
import type { AgentTrace, BusyBlock, ChatMessage, PlanResult, Task, TaskOp } from "../types";
import { runPlanner } from "./planner";
import { forSpeech } from "../speech";
import { dispatchTool, TASK_TOOLS } from "./tools";

/**
 * Dialogue agent — the "on-device" side. Small fast model, holds the
 * conversation, and edits the list through tools. When the user asks for
 * something bigger than an edit it calls request_replan, which routes the turn
 * to the heavier planner (the Office Kit handoff) and then reads the result back.
 */

const MAX_TOOL_ROUNDS = 4;

function systemPrompt(tasks: Task[], busy: BusyBlock[], now: Date): string {
  return `You are "Your Tasks" — a to-do assistant the user is talking to on a phone call they just answered.

HOW YOU TALK
- This is speech, not chat. Short sentences. No markdown, no bullet points, no lists, no emoji.
- Two or three sentences per turn, maximum. You are on a call; long replies are unusable.
- Never read out ids, timestamps, or priority numbers. Say "the client deck at two", not "[client-deck] P1 14:00".
- Be warm but efficient, like a good assistant who knows the user is busy.
- End most turns with a short question so the user knows it is their turn.

HOW YOU ACT
- Any change to the list MUST go through a tool call. Never claim you changed something you did not.
- Only call add_task when the user describes a genuinely NEW thing to do. Asking you to read,
  list or repeat the existing tasks is NOT a request to add one.
- Make the change first, then confirm it in your reply using what the tool told you.
- If the user is vague about which task, ask which one. Do not guess between two plausible tasks.
- If the user asks for a whole-day or multi-task reorganisation, call request_replan. Do not attempt
  to order the day yourself — the planner on the laptop does that.
- One edit means one tool call. Do not call request_replan for a single reschedule.
- If the user just ASKS about the list ("what's left", "what's due today", "read them back"),
  the current list is already below — answer straight from it. Use list_tasks only if you
  need it restated. Never invent a tool name that is not in your tool list.
- When the user is done, call end_call.

CURRENT TIME: ${now.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}

CURRENT LIST
${describeTasks(tasks)}

${describeCalendar(busy)}`;
}

export interface DialogueOutcome {
  reply: string;
  tasks: Task[];
  ops: TaskOp[];
  plan: PlanResult | null;
  route: "on-device" | "laptop";
  trace: AgentTrace[];
  endCall: boolean;
}

export async function runDialogue(
  userText: string,
  history: ChatMessage[],
  tasksIn: Task[],
  busy: BusyBlock[],
  now: Date,
): Promise<DialogueOutcome> {
  const started = Date.now();
  let tasks = tasksIn;
  const ops: TaskOp[] = [];
  const trace: AgentTrace[] = [];
  let plan: PlanResult | null = null;
  let route: "on-device" | "laptop" = "on-device";
  let endCall = false;

  const messages: GroqMessage[] = [
    { role: "system", content: systemPrompt(tasks, busy, now) },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content }) as GroqMessage),
    { role: "user", content: userText },
  ];

  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const roundStart = Date.now();
    const msg = await chat({
      model: MODELS.dialogue,
      messages,
      tools: TASK_TOOLS,
      temperature: 0.5,
      maxTokens: 450,
      reasoningEffort: "low",
    });

    trace.push({
      agent: round === 0 ? "Dialogue (on-device)" : "Dialogue follow-up",
      model: MODELS.dialogue,
      route: "on-device",
      ms: Date.now() - roundStart,
      detail: msg.tool_calls?.length
        ? `called ${msg.tool_calls.map((c) => c.function.name).join(", ")}`
        : "spoken reply",
    });

    if (!msg.tool_calls?.length) {
      reply = forSpeech(msg.content || "");
      break;
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

    let replanScope: string | null = null;

    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }

      const result = dispatchTool(call.function.name, args, tasks, now, userText);
      tasks = result.tasks;
      ops.push(...result.ops);
      if (result.endCall) endCall = true;
      if (result.replanRequested) replanScope = result.replanScope ?? "today";

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result.message,
      });
    }

    // Office Kit handoff: the heavy planner computes, then the dialogue agent
    // gets the finished schedule back as a tool result to read out.
    if (replanScope) {
      route = "laptop";
      const outcome = await runPlanner(tasks, busy, replanScope, now);
      plan = outcome.plan;
      trace.push(outcome.trace);
      messages.push({
        role: "system",
        content: `The laptop planner returned this. Read it back to the user in two or three spoken sentences. Do not change any times.\n\n${outcome.narration}`,
      });
    }
  }

  if (!reply) {
    reply = plan
      ? "I've got the replan back from the laptop — want me to walk you through it?"
      : summarize(tasks, ops);
  }

  trace.push({
    agent: "Turn total",
    model: "—",
    route,
    ms: Date.now() - started,
    detail: `${ops.length} task op(s)`,
  });

  return { reply, tasks, ops, plan, route, trace, endCall };
}

/** Last-resort reply so the call never goes silent on the user. */
function summarize(tasks: Task[], ops: TaskOp[]): string {
  if (ops.length) return `Done — ${ops.map((o) => o.summary.toLowerCase()).join(", and ")}. Anything else?`;
  const open = tasks.filter((t) => t.status === "open");
  if (!open.length) return "Your list is clear. Want to add something?";
  const next = open[0];
  return `You've got ${open.length} open. Next up is ${next.title}, ${fmt(next.deadline)}. Want to go through them?`;
}
