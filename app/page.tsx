"use client";

import { useEffect } from "react";
import { Phone } from "@/components/Phone";
import { PipelinePanel } from "@/components/PipelinePanel";
import { PlanPanel } from "@/components/PlanPanel";
import { TaskBoard } from "@/components/TaskBoard";
import { useCallController } from "@/store/useCallController";

const PROMPTS = [
  "Push the client deck to tomorrow morning",
  "Mark the standup notes done",
  "Replan my afternoon",
  "Add: call the landlord at 6",
];

export default function Home() {
  const c = useCallController();

  // Warm up the speech voice list; Chrome populates it lazily.
  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }, []);

  const inCall = c.phase === "in-call";

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1560px] flex-col gap-8 px-6 py-8 xl:px-10">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-[3.4rem] leading-[0.95] text-white">Kukoo</h1>
          <p className="mt-1 font-display text-[1.35rem] italic leading-none text-coral">We Call. You Do.</p>
          <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-white/45">
            The to-do list that calls you, instead of waiting to be opened. Answer the phone and
            change your day by talking — the board on the right updates as you speak.
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-[11px] text-white/35">
          <Badge>Groq · whisper + gpt-oss</Badge>
          <Badge>turn-based voice loop</Badge>
          <Badge>EDF scheduler</Badge>
        </div>
      </header>

      {c.error && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-[12.5px] text-rose-300">
          {c.error}
        </div>
      )}

      <div className="grid flex-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)]">
        <div className="order-2 flex min-h-0 flex-col gap-6 xl:order-1">
          <PipelinePanel />
          <TryPanel onPick={c.sendTurn} disabled={!inCall} />
        </div>

        <div className="order-1 flex justify-center xl:order-2">
          <Phone
            onCall={c.startCall}
            onAnswer={c.answer}
            onHangUp={c.hangUp}
            onMicDown={c.micDown}
            onMicUp={c.micUp}
            onType={c.sendTurn}
            listenMode={c.listenMode}
            level={c.recorder.level}
            recording={c.recorder.recording}
            micError={c.recorder.permissionError}
          />
        </div>

        <div className="order-3 flex min-h-0 flex-col gap-6">
          <TaskBoard />
          <PlanPanel />
        </div>
      </div>

      <footer className="border-t border-white/[0.06] pt-5 text-[11.5px] leading-relaxed text-white/28">
        Simulated in-app call, not a telecom call — by design. The voice loop is turn-based: hold the mic
        and release, or tap once and tap again to send. Single edits are handled on the device path; whole-day
        replanning is handed to the laptop planner over the Office Kit route.
      </footer>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[10px]">
      {children}
    </span>
  );
}

/** Judge-proof path: the same turn pipeline, without depending on a room mic. */
function TryPanel({ onPick, disabled }: { onPick: (t: string) => void; disabled: boolean }) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-1.5 font-display text-[1.5rem] leading-none text-white">Try saying</h2>
      <p className="mb-3.5 text-[11.5px] leading-snug text-white/40">
        {disabled
          ? "Answer the call first — then speak, or click one of these to send it as a turn."
          : "Hold the mic (or tap once) and say one of these, or click to send it straight through."}
      </p>
      <div className="flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            disabled={disabled}
            onClick={() => onPick(p)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left text-[11.5px] text-white/65 transition hover:border-coral/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            &ldquo;{p}&rdquo;
          </button>
        ))}
      </div>
    </section>
  );
}
