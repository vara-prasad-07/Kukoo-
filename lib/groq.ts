/**
 * Thin Groq wrapper. Every model id is env-overridable so the demo can be
 * retargeted (or swapped to an on-device runtime) without touching agent code.
 */

const BASE = "https://api.groq.com/openai/v1";

export const MODELS = {
  /** Stands in for the small on-device model: dialogue + task edits. */
  dialogue: process.env.GROQ_DIALOGUE_MODEL || "openai/gpt-oss-20b",
  /** Stands in for laptop compute over Office Kit: heavy replanning. */
  planner: process.env.GROQ_PLANNER_MODEL || "openai/gpt-oss-120b",
  // large-v3 over turbo: same latency in practice, better on accented English.
  stt: process.env.GROQ_STT_MODEL || "whisper-large-v3",
  tts: process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
} as const;

export function hasKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}

function key(): string {
  const k = process.env.GROQ_API_KEY;
  if (!k) throw new Error("GROQ_API_KEY is not set. Add it to .env and restart the dev server.");
  return k;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatOpts {
  model: string;
  messages: GroqMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** gpt-oss models expose this; low keeps voice latency down. */
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Groq replies "Please try again in 4.5075s" — use its own number, not a guess. */
function retryAfterMs(body: string, headers: Headers): number | null {
  const header = headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const m = body.match(/try again in ([\d.]+)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  return null;
}

export async function chat(opts: ChatOpts): Promise<GroqMessage> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_completion_tokens: opts.maxTokens ?? 900,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.model.includes("gpt-oss")) body.reasoning_effort = opts.reasoningEffort ?? "low";

  // The free tier is 8k tokens/minute, which a two-round tool loop can genuinely
  // exhaust mid-call. Back off and retry rather than dropping the turn on stage.
  const MAX_ATTEMPTS = 3;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (res.ok) {
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("Groq returned no message.");
      return msg as GroqMessage;
    }

    const text = await res.text();
    lastError = `Groq chat ${res.status}: ${text.slice(0, 300)}`;

    // The model invented a tool name and Groq rejected the whole request. Drop
    // the tool list and ask again so the user still gets a spoken answer
    // instead of the turn collapsing.
    if (res.status === 400 && /not in request\.tools|tool_call_validation/i.test(text) && body.tools) {
      delete body.tools;
      delete body.tool_choice;
      continue;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS - 1) break;

    const wait = Math.min(retryAfterMs(text, res.headers) ?? 1000 * 2 ** attempt, 6000);
    await sleep(wait + 150);
  }

  throw new Error(lastError || "Groq chat failed.");
}

/**
 * No `prompt` is sent to Whisper. A/B tested against real speech, the vocabulary
 * hint gave zero accuracy benefit on clean audio — and it is exactly what the
 * decoder echoed back as a fake transcript when the audio was poor. The words
 * below are kept only so that echo can still be recognised and discarded.
 */
const STT_VOCAB = "RingList, Kukoo, to-do, reschedule, deadline, priority, replan, standup, deck, follow-up, Priya";

/**
 * Things Whisper emits when it hears nothing useful. These are artifacts of the
 * training data (subtitle corpora), not transcriptions, and must never reach the
 * dialogue agent as if the user had said them.
 */
const HALLUCINATIONS = [
  "thank you", "thanks for watching", "thank you for watching", "bye", "bye bye",
  "you", "okay", "ok", ".", "..", "...", "uh", "um", "mm", "hmm",
  "subtitles by the amara.org community", "subs by www.zeoranger.co.uk",
  "please subscribe", "transcription by castingwords", "i'm sorry",
];

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

/** Subtitle-corpus artifacts whose exact wording varies; match on a fragment. */
const ARTIFACT_FRAGMENTS = ["amara", "subtitle", "subscribe", "castingwords", "zeoranger"];

/** True when the transcript is an artifact rather than something the user said. */
export function isHallucination(text: string): boolean {
  const n = normalize(text);
  if (!n) return true;
  // Compare like with like — the list is normalized the same way as the input.
  if (HALLUCINATIONS.map(normalize).includes(n)) return true;
  if (ARTIFACT_FRAGMENTS.some((f) => n.includes(f))) return true;
  // Prompt echo: the decoder parroted the vocabulary hint back at us. Compare
  // word by word, because it echoes arbitrary fragments ("RingList", "to-do,
  // reschedule") rather than the whole string.
  const vocabWords = new Set(normalize(STT_VOCAB).split(" ").filter(Boolean));
  const words = n.split(" ").filter(Boolean);
  if (words.length <= 4 && words.every((w) => vocabWords.has(w))) return true;
  if (n.includes("speaker is talking about")) return true;
  // A lone word under three characters is noise, not an instruction.
  if (n.length < 3) return true;
  return false;
}

export async function transcribe(file: Blob, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, filename);
  fd.append("model", MODELS.stt);
  fd.append("response_format", "json");
  // Pinning the language stops Whisper misdetecting short clips as another
  // language and "translating" them into nonsense.
  fd.append("language", "en");
  // Greedy decoding: no temperature fallback, which is where most of the
  // confident-sounding invented sentences come from.
  fd.append("temperature", "0");

  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data?.text ?? "").trim();
  return isHallucination(text) ? "" : text;
}

export interface SpeechResult {
  ok: boolean;
  audio?: ArrayBuffer;
  contentType?: string;
  /** Why server TTS was unavailable — the client falls back to browser speech. */
  reason?: string;
}

export async function speak(text: string, voice: string): Promise<SpeechResult> {
  if (!hasKey()) return { ok: false, reason: "no-key" };
  try {
    const res = await fetch(`${BASE}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELS.tts, input: text, voice, response_format: "wav" }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, reason: detail.includes("terms") ? "terms-required" : detail };
    }
    return { ok: true, audio: await res.arrayBuffer(), contentType: res.headers.get("content-type") || "audio/wav" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "tts-failed" };
  }
}

/** Pull the first JSON object out of a model reply that may be wrapped in prose or fences. */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
