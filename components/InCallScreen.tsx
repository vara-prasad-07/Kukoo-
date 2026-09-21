"use client";

import { useEffect, useRef, useState } from "react";
import { useCall } from "@/store/useCall";
import { MicIcon, MicOff, PhoneOff } from "./Icons";

interface Props {
  level: number;
  recording: boolean;
  listenMode: "idle" | "hold" | "tap";
  onMicDown: () => void;
  onMicUp: () => void;
  onHangUp: () => void;
  onType: (text: string) => void;
  micError: string | null;
}

export function InCallScreen({
  level,
  recording,
  listenMode,
  onMicDown,
  onMicUp,
  onHangUp,
  onType,
  micError,
}: Props) {
  const { transcript, voice, muted, toggleMute, handoffActive } = useCall();
  const [seconds, setSeconds] = useState(0);
  const [typed, setTyped] = useState("");
  const [showType, setShowType] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length, voice]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const status =
    voice === "listening"
      ? listenMode === "tap"
        ? "Listening — tap the mic again to send"
        : "Listening… release to send"
      : voice === "thinking"
        ? handoffActive
          ? "Thinking on the laptop…"
          : "Thinking…"
        : voice === "speaking"
          ? "Speaking"
          : "Hold the mic to talk, or tap once";

  return (
    <div className="flex h-full flex-col px-5 pb-6 pt-5">
      <div className="mb-3 flex flex-col items-center">
        <div className="mb-2.5 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-coral to-coral-dim text-[1.15rem]">
          📋
        </div>
        <h3 className="font-display text-[1.45rem] leading-none text-white">Your Tasks</h3>
        <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-white/40">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          {mmss}
        </div>
      </div>

      <div className="scroll-thin mb-3 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {transcript.map((t) => (
          <Bubble key={t.id} role={t.role} text={t.text} viaLaptop={t.viaLaptop} />
        ))}
        {voice === "thinking" && <Thinking laptop={handoffActive} />}
        <div ref={endRef} />
      </div>

      {micError && (
        <p className="mb-2 rounded-lg bg-rose-500/12 px-3 py-2 text-[11px] leading-snug text-rose-300">
          {micError}
        </p>
      )}

      {showType ? (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = typed.trim();
            if (!v) return;
            setTyped("");
            onType(v);
          }}
        >
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type instead of speaking…"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-[12.5px] text-white/90 outline-none placeholder:text-white/30 focus:border-coral/50"
          />
          <button type="submit" className="rounded-xl bg-coral px-3.5 text-[12.5px] font-semibold text-[#2a0f07]">
            Send
          </button>
        </form>
      ) : null}

      <Waveform level={level} active={recording} speaking={voice === "speaking"} />

      <p className="mb-3 mt-2 text-center text-[11.5px] text-white/45">{status}</p>

      <div className="flex items-center justify-center gap-7">
        <SmallBtn label={muted ? "Unmute" : "Mute"} onClick={toggleMute} active={muted}>
          {muted ? <MicOff className="h-[18px] w-[18px]" /> : <MicIcon className="h-[18px] w-[18px]" />}
        </SmallBtn>

        <button
          aria-label="Hold to talk, or tap once to latch"
          disabled={voice === "thinking" || voice === "speaking"}
          // Pointer capture keeps the release bound to this button even if the
          // finger drifts off it, so a slide-off can't strand the recorder.
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            onMicDown();
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            onMicUp();
          }}
          onPointerCancel={() => onMicUp()}
          className={`relative grid h-[68px] w-[68px] place-items-center rounded-full transition disabled:opacity-35 ${
            recording ? "bg-coral text-[#2a0f07] scale-105" : "bg-white/[0.09] text-white/85 hover:bg-white/[0.14]"
          }`}
        >
          {recording && <span className="absolute inset-0 rounded-full border-2 border-coral animate-pulseRing" />}
          <MicIcon className="h-6 w-6" />
        </button>

        <SmallBtn label="Type" onClick={() => setShowType((v) => !v)} active={showType}>
          <span className="text-[13px] font-semibold">Aa</span>
        </SmallBtn>
      </div>

      <button
        onClick={onHangUp}
        className="mx-auto mt-5 grid h-12 w-12 place-items-center rounded-full bg-rose-500 text-white transition hover:bg-rose-400 active:scale-95"
        aria-label="Hang up"
      >
        <PhoneOff className="h-[21px] w-[21px]" />
      </button>
    </div>
  );
}

function Bubble({ role, text, viaLaptop }: { role: "user" | "assistant"; text: string; viaLaptop?: boolean }) {
  const mine = role === "user";
  return (
    <div className={`flex animate-slideUp ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
          mine ? "rounded-br-md bg-coral text-[#2a0f07]" : "rounded-bl-md bg-white/[0.08] text-white/88"
        }`}
      >
        {!mine && viaLaptop && (
          <span className="mb-1.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-sky">
            <span className="h-1 w-1 rounded-full bg-sky" /> via laptop planner
          </span>
        )}
        {text}
      </div>
    </div>
  );
}

function Thinking({ laptop }: { laptop: boolean }) {
  return (
    <div className="flex animate-slideUp justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-white/[0.08] px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${laptop ? "bg-sky" : "bg-white/55"}`}
            style={{ animation: "bar 1s ease-in-out infinite", animationDelay: `${i * 0.16}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Real mic amplitude while recording; an idle shimmer otherwise. */
function Waveform({ level, active, speaking }: { level: number; active: boolean; speaking: boolean }) {
  const bars = 28;
  return (
    <div className="flex h-11 items-center justify-center gap-[3px]">
      {Array.from({ length: bars }).map((_, i) => {
        const centreBias = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const h = active
          ? Math.max(3, level * 38 * (0.45 + centreBias * 0.9) * (0.7 + Math.random() * 0.6))
          : speaking
            ? 4 + centreBias * 10
            : 3;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full transition-[height] duration-75 ${
              active ? "bg-coral" : speaking ? "bg-sky/70" : "bg-white/15"
            }`}
            style={{
              height: `${h}px`,
              ...(speaking ? { animation: "bar 0.85s ease-in-out infinite", animationDelay: `${i * 0.045}s` } : {}),
            }}
          />
        );
      })}
    </div>
  );
}

function SmallBtn({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5" aria-label={label}>
      <span
        className={`grid h-11 w-11 place-items-center rounded-full transition ${
          active ? "bg-coral text-[#2a0f07]" : "bg-white/[0.08] text-white/75 hover:bg-white/[0.13]"
        }`}
      >
        {children}
      </span>
      <span className="text-[10px] text-white/35">{label}</span>
    </button>
  );
}
