import { NextResponse } from "next/server";
import { runDialogue } from "@/lib/agents/dialogue";
import { hasKey } from "@/lib/groq";
import type { BusyBlock, ChatMessage, Task, TurnResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One conversational turn. The client owns the task list and posts it in; the
 * server applies the turn and posts the whole updated list back, so the board
 * and the call can never drift apart.
 */
export async function POST(req: Request) {
  if (!hasKey()) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not set. Add it to .env and restart the dev server." },
      { status: 503 },
    );
  }

  let body: {
    text?: string;
    history?: ChatMessage[];
    tasks?: Task[];
    busy?: BusyBlock[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const text = (body.text || "").trim();
  if (!text) return NextResponse.json({ error: "Nothing was said." }, { status: 400 });
  if (!Array.isArray(body.tasks)) {
    return NextResponse.json({ error: "tasks must be an array." }, { status: 400 });
  }

  try {
    const outcome = await runDialogue(
      text,
      body.history ?? [],
      body.tasks,
      body.busy ?? [],
      new Date(),
    );
    const payload: TurnResponse = {
      reply: outcome.reply,
      ops: outcome.ops,
      tasks: outcome.tasks,
      route: outcome.route,
      plan: outcome.plan,
      trace: outcome.trace,
      endCall: outcome.endCall,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error("[turn]", detail);
    return NextResponse.json({ error: `Agent failed: ${detail}` }, { status: 500 });
  }
}
