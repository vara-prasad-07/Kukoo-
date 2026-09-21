"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/taskEngine";
import type { Task } from "@/lib/types";
import { useCall } from "@/store/useCall";
import { PhoneIcon } from "./Icons";

/** The phone at rest: what the user would ignore, if the list didn't call them. */
export function HomeScreen({ onCall }: { onCall: () => void }) {
  const tasks = useCall((s) => s.tasks);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const open = tasks.filter((t) => t.status === "open");

  return (
    <div className="flex h-full flex-col px-6 pb-7 pt-4">
      <div className="mb-6 flex items-center justify-between text-[11px] font-medium text-white/45">
        <span>Kukoo</span>
        <span className="font-mono">{clock}</span>
      </div>

      <div className="mb-1 font-display text-[2.1rem] leading-none text-white/92">
        {new Date().toLocaleDateString("en-US", { weekday: "long" })}
      </div>
      <p className="mb-5 text-[12px] text-white/40">
        {open.length} open · next call at 8:30 AM
      </p>

      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto pr-1">
        {open.slice(0, 6).map((t) => (
          <Row key={t.id} task={t} />
        ))}
        {!open.length && (
          <p className="pt-8 text-center text-[12px] text-white/30">Nothing open. Enjoy it.</p>
        )}
      </div>

      <button
        onClick={onCall}
        className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-coral py-3.5 text-[14px] font-semibold text-[#2a0f07] transition hover:bg-coral-glow active:scale-[0.985]"
      >
        <PhoneIcon className="h-[18px] w-[18px]" />
        Simulate today&apos;s call
      </button>
      <p className="mt-2.5 text-center text-[10.5px] leading-tight text-white/28">
        On the phone this fires from a scheduled trigger
      </p>
    </div>
  );
}

function Row({ task }: { task: Task }) {
  const flashed = useCall((s) => s.flashed.includes(task.id));
  const dot = task.priority === 1 ? "bg-coral" : task.priority === 2 ? "bg-amber" : "bg-white/25";
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.035] px-3.5 py-2.5 ${flashed ? "animate-flash" : ""}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-[13px] text-white/85">{task.title}</span>
      </div>
      <span className="shrink-0 font-mono text-[10.5px] text-white/38">{fmt(task.deadline)}</span>
    </div>
  );
}
