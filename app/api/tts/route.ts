import { NextResponse } from "next/server";
import { speak } from "@/lib/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side voice. Returns 204 with a reason header when the hosted TTS model
 * is unavailable, which tells the client to use browser speech synthesis instead.
 */
export async function POST(req: Request) {
  let text = "";
  let voice = "tara";
  try {
    const body = (await req.json()) as { text?: string; voice?: string };
    text = (body.text || "").slice(0, 900);
    voice = body.voice || "tara";
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "No text." }, { status: 400 });

  const result = await speak(text, voice);
  if (!result.ok || !result.audio) {
    return new NextResponse(null, {
      status: 204,
      headers: { "x-tts-fallback": result.reason?.slice(0, 120) || "unavailable" },
    });
  }
  return new NextResponse(result.audio, {
    status: 200,
    headers: { "Content-Type": result.contentType || "audio/wav", "Cache-Control": "no-store" },
  });
}
