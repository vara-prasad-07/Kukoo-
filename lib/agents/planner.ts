import { chat, MODELS } from "../groq";
import { forSpeech } from "../speech";
import { describeCalendar } from "../taskEngine";
import type { AgentTrace, BusyBlock, PlanResult, Task } from "../types";
import { buildPlan, describePlan } from "./scheduler";

/**
 * Planner agent — the "laptop compute" side of the Office Kit handoff.
 *
 * Split of responsibility, on purpose:
 *   - buildPlan() decides the schedule. Deterministic, no model.
 *   - the heavy model only turns that schedule into something worth hearing on a
 *     phone call, and is explicitly forbidden from reordering it.
 */
export interface PlanOutcome {
  plan: PlanResult;
  narration: string;
  trace: AgentTrace;
}

const NARRATOR_SYSTEM = `You are the planning voice of a to-do assistant, speaking on a phone call.

WHAT TO SAY
- Two or three sentences, then one short question handing control back to the user.
- Lead with the shape of the day — the first one or two things and roughly when.
  Do not recite every block; the user can see the list.
- If there are CONFLICTS you MUST say so, specifically, before your closing question.
  Name the task and what is wrong ("the deck won't fit before two — that's the one
  to move"). Never present a plan with conflicts as if everything is fine.
- Natural spoken clock language: "half past four", "by six", "right after the review".

WHAT NOT TO SAY
- Never mention the scheduler, the planner, the algorithm, or that times were
  "computed" or "set". The user is talking to an assistant, not reading a system log.
- No markdown, no bullet points, no numbered lists, no emoji, no ids, no 24-hour times.

CONSTRAINT (never state this aloud): the times you are given are final. Do not
reorder, re-time, invent, merge or drop any item.`;

export async function runPlanner(
  tasks: Task[],
  busy: BusyBlock[],
  scope: string,
  now: Date,
): Promise<PlanOutcome> {
  const started = Date.now();
  const plan = buildPlan({ tasks, busy, now });

  let narration = "";
  try {
    const msg = await chat({
      model: MODELS.planner,
      temperature: 0.45,
      maxTokens: 400,
      reasoningEffort: "low",
      messages: [
        { role: "system", content: NARRATOR_SYSTEM },
        {
          role: "user",
          content: `The user asked to replan: "${scope}".
Current time: ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
${describeCalendar(busy)}

${describePlan(plan)}

${
  plan.conflicts.length
    ? `There ${plan.conflicts.length === 1 ? "is 1 conflict" : `are ${plan.conflicts.length} conflicts`} above. You must mention ${plan.conflicts.length === 1 ? "it" : "the most serious one or two"} out loud and suggest what to move or drop.`
    : `There are no conflicts — everything fits.`
}

Read this back to them.`,
        },
      ],
    });
    narration = forSpeech(msg.content || "");
  } catch {
    narration = "";
  }

  if (!narration) narration = fallbackNarration(plan);

  return {
    plan,
    narration,
    trace: {
      agent: "Planner (laptop)",
      model: MODELS.planner,
      route: "laptop",
      ms: Date.now() - started,
      detail: `EDF + time-boxing · ${plan.blocks.length} block(s), ${plan.conflicts.length} conflict(s), ${plan.utilizationPct}% utilization`,
    },
  };
}

/** Used when the narrating model is unreachable — the plan itself still stands. */
function fallbackNarration(plan: PlanResult): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (!plan.blocks.length) return "There's nothing left to schedule in the window we have.";
  const first = plan.blocks.slice(0, 3).map((b) => `${b.title} at ${t(b.start)}`);
  const head = `Here's the replan: ${first.join(", then ")}.`;
  const tail = plan.conflicts.length
    ? ` Heads up — ${plan.conflicts[0].title} doesn't fit; ${plan.conflicts[0].reason.toLowerCase()}`
    : " Everything fits.";
  return `${head}${tail} Want me to lock that in?`;
}
