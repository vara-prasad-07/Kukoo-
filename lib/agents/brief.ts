import { chat, MODELS } from "../groq";
import { forSpeech } from "../speech";
import { describeTasks, fmt } from "../taskEngine";
import type { AgentTrace, Task } from "../types";

/**
 * Briefing agent — produces the single line the assistant says the instant the
 * user answers the call. This is the first thing the audience hears, so it runs
 * on the fast model and always has a deterministic fallback.
 */
export interface BriefOutcome {
  greeting: string;
  trace: AgentTrace;
}

const SYSTEM = `You open a phone call to someone about their to-do list. They just picked up.

Write ONE opening turn, two sentences maximum:
1. What is on their plate right now — lead with the most time-critical item by name.
2. A short question inviting them in, like "Want to go through them?".

Rules: spoken English only. No markdown, no lists, no emoji, no greeting fluff like
"I hope you're well". Never read out ids or 24-hour timestamps. Sound like a competent
assistant, not a notification.`;

export async function runBrief(tasks: Task[], now: Date): Promise<BriefOutcome> {
  const started = Date.now();
  const open = tasks.filter((t) => t.status === "open");

  let greeting = "";
  try {
    const msg = await chat({
      model: MODELS.dialogue,
      temperature: 0.6,
      maxTokens: 200,
      reasoningEffort: "low",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Time is ${now.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}.\n\n${describeTasks(tasks)}`,
        },
      ],
    });
    greeting = forSpeech(msg.content || "");
  } catch {
    greeting = "";
  }

  if (!greeting) greeting = fallback(open);

  return {
    greeting,
    trace: {
      agent: "Briefing (on-device)",
      model: MODELS.dialogue,
      route: "on-device",
      ms: Date.now() - started,
      detail: `${open.length} open task(s)`,
    },
  };
}

function fallback(open: Task[]): string {
  if (!open.length) return "Your list is completely clear today. Want to plan something in?";
  const soonest = [...open].sort((a, b) => {
    const da = a.deadline ? Date.parse(a.deadline) : Infinity;
    const db = b.deadline ? Date.parse(b.deadline) : Infinity;
    return da - db;
  })[0];
  return `You've got ${open.length} thing${open.length === 1 ? "" : "s"} today — ${soonest.title} is due ${fmt(soonest.deadline)}. Want to go through them?`;
}
