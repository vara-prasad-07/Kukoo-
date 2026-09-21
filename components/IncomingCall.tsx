"use client";

import { useEffect, useState } from "react";
import { PhoneIcon, PhoneOff } from "./Icons";

/**
 * The whole pitch in one screen. It has to read as a real incoming call from
 * across a room, so: big avatar, pulsing rings, slide-to-answer, live ringtone.
 */
export function IncomingCall({ onAnswer, onDecline }: { onAnswer: () => void; onDecline: () => void }) {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Slide-to-answer, with a keyboard path so the demo never depends on a gesture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onAnswer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  const commit = () => {
    setDragging(false);
    if (drag > 0.62) onAnswer();
    else setDrag(0);
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-between overflow-hidden px-6 pb-9 pt-16">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(28rem 22rem at 50% 26%, rgba(255,122,92,0.22), transparent 66%)" }}
      />

      <div className="relative flex flex-col items-center">
        <p className="mb-8 text-[11.5px] font-medium uppercase tracking-[0.24em] text-white/45">
          Incoming call
        </p>

        <div className="relative mb-7 grid place-items-center">
          <span className="absolute h-24 w-24 rounded-full border border-coral/45 animate-pulseRing" />
          <span
            className="absolute h-24 w-24 rounded-full border border-coral/45 animate-pulseRing"
            style={{ animationDelay: "0.9s" }}
          />
          <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-coral to-coral-dim text-[2rem] shadow-[0_0_44px_-6px_rgba(255,122,92,0.75)]">
            <span className="animate-ring">📋</span>
          </div>
        </div>

        <h2 className="font-display text-[2.35rem] leading-none text-white">Your Tasks</h2>
        <p className="mt-2.5 text-[12.5px] text-white/45">mobile · Kukoo</p>
      </div>

      <div className="relative w-full">
        <div
          className="relative mb-6 h-14 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.05]"
          onPointerMove={(e) => {
            if (!dragging) return;
            const box = e.currentTarget.getBoundingClientRect();
            setDrag(Math.max(0, Math.min(1, (e.clientX - box.left - 28) / (box.width - 56))));
          }}
          onPointerUp={commit}
          onPointerLeave={() => dragging && commit()}
        >
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] font-medium tracking-wide text-white/40">
            {drag > 0.15 ? "keep sliding…" : "slide to answer"}
          </span>
          <button
            aria-label="Slide to answer"
            onPointerDown={() => setDragging(true)}
            onClick={() => !dragging && drag === 0 && onAnswer()}
            className="absolute top-1.5 grid h-11 w-11 cursor-grab place-items-center rounded-full bg-mint text-[#062a12] shadow-lg active:cursor-grabbing"
            style={{ left: `calc(0.375rem + ${drag} * (100% - 3.25rem))`, transition: dragging ? "none" : "left 0.22s ease" }}
          >
            <PhoneIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-14">
          <Action label="Decline" onClick={onDecline} tone="rose">
            <PhoneOff className="h-[22px] w-[22px]" />
          </Action>
          <Action label="Answer" onClick={onAnswer} tone="mint">
            <PhoneIcon className="h-[22px] w-[22px]" />
          </Action>
        </div>
      </div>
    </div>
  );
}

function Action({
  children,
  label,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  tone: "mint" | "rose";
}) {
  const cls = tone === "mint" ? "bg-mint text-[#062a12]" : "bg-rose-500 text-white";
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-2" aria-label={label}>
      <span className={`grid h-14 w-14 place-items-center rounded-full ${cls} transition group-hover:scale-105 group-active:scale-95`}>
        {children}
      </span>
      <span className="text-[11px] text-white/45">{label}</span>
    </button>
  );
}
