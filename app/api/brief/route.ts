import { NextResponse } from "next/server";
import { runBrief } from "@/lib/agents/brief";
import { hasKey } from "@/lib/groq";
import type { Task } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The opening line, generated the moment the user answers the call. */
export async function POST(req: Request) {
  if (!hasKey()) {
    return NextResponse.json({ error: "GROQ_API_KEY is not set." }, { status: 503 });
  }
  try {
    const body = (await req.json()) as { tasks?: Task[] };
    const outcome = await runBrief(body.tasks ?? [], new Date());
    return NextResponse.json({ greeting: outcome.greeting, trace: [outcome.trace] });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error("[brief]", detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
