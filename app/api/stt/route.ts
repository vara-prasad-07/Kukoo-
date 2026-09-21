import { NextResponse } from "next/server";
import { hasKey, transcribe } from "@/lib/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Speech to text for one recorded utterance. */
export async function POST(req: Request) {
  if (!hasKey()) {
    return NextResponse.json({ error: "GROQ_API_KEY is not set." }, { status: 503 });
  }
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No audio uploaded." }, { status: 400 });
    }
    // Opus at ~16kbps: anything under this is well below half a second, which is
    // exactly the input that makes Whisper invent a sentence.
    if (file.size < 3000) {
      return NextResponse.json({ text: "", tooShort: true });
    }
    const name = file instanceof File && file.name ? file.name : "speech.webm";
    const text = await transcribe(file, name);
    return NextResponse.json({ text });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    console.error("[stt]", detail);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
