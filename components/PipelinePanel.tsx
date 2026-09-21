"use client";

import { useCall } from "@/store/useCall";
import { ChipIcon, LaptopIcon } from "./Icons";

const STAGES = [
  { key: "stt", label: "Speech to text", sub: "whisper-large-v3-turbo" },
  { key: "dialogue", label: "Dialogue agent", sub: "gpt-oss-20b · tool calling" },
  { key: "engine", label: "Task engine", sub: "deterministic, no model" },
  { key: "planner", label: "Planner agent", sub: "gpt-oss-120b · EDF" },
  { key: "tts", label: "Text to speech", sub: "voice out" },
] as const;

/**
 * Makes the routing decision legible to a judge standing three metres away:
 * which stage is lit, whether this turn stayed on-device, and what each hop cost.
 */
export function PipelinePanel() {
  const { voice, route, trace, handoffActive, phase } = useCall();

  const activeStage =
    voice === "listening"
      ? "stt"
      : voice === "thinking"
        ? handoffActive
          ? "planner"
          : "dialogue"
        : voice === "speaking"
          ? "tts"
          : null;

  const live = phase === "in-call";

  return (
    <section className="glass flex min-h-0 flex-col rounded-2xl p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-[1.5rem] leading-none text-white">Agent pipeline</h2>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] ${
            route === "laptop" ? "bg-sky/15 text-sky" : "bg-mint/12 text-mint"
          }`}
        >
          {route === "laptop" ? <LaptopIcon className="h-3 w-3" /> : <ChipIcon className="h-3 w-3" />}
          {route === "laptop" ? "laptop" : "on-device"}
        </span>
      </header>

      <ol className="mb-4 space-y-1.5">
        {STAGES.map((s) => {
          const isActive = live && activeStage === s.key;
          const isPlanner = s.key === "planner";
          return (
            <li
              key={s.key}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200 ${
                isActive
                  ? isPlanner
                    ? "border-sky/45 bg-sky/10"
                    : "border-coral/45 bg-coral/10"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isActive ? (isPlanner ? "bg-sky" : "bg-coral") : "bg-white/18"
                }`}
                style={isActive ? { animation: "bar 0.9s ease-in-out infinite" } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className={`text-[12.5px] leading-tight ${isActive ? "text-white" : "text-white/62"}`}>
                  {s.label}
                </p>
                <p className="mt-0.5 truncate font-mono text-[9.5px] text-white/30">{s.sub}</p>
              </div>
              {isPlanner && (
                <span className="shrink-0 rounded bg-sky/12 px-1.5 py-0.5 font-mono text-[8.5px] text-sky/80">
                  office kit
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="min-h-0 flex-1">
        <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/30">
          Last turn
        </p>
        {trace.length ? (
          <ul className="scroll-thin max-h-40 space-y-1 overflow-y-auto pr-1">
            {trace.map((t, i) => (
              <li key={`${t.agent}-${i}`} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className={t.route === "laptop" ? "text-sky/85" : "text-white/62"}>{t.agent}</span>
                <span className="shrink-0 font-mono text-[10px] text-white/32">{t.ms}ms</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-white/30">Answer the call to see the pipeline run.</p>
        )}
      </div>
    </section>
  );
}
