"use client";

import { useEffect } from "react";
import { fmt } from "@/lib/taskEngine";
import type { Task } from "@/lib/types";
import { useCall } from "@/store/useCall";
import { CheckIcon, ClockIcon } from "./Icons";

/**
 * The mirror of the call. Everything the user changes by voice lands here within
 * the same turn — this is the panel to point a camera at during the pitch.
 */
export function TaskBoard() {
  const { tasks, flashed, clearFlash, activity } = useCall();

  useEffect(() => {
    if (!flashed.length) return;
    const id = setTimeout(clearFlash, 1200);
    return () => clearTimeout(id);
  }, [flashed, clearFlash]);

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  const parked = tasks.filter((t) => t.status === "deferred");

  return (
    <section className="glass flex min-h-0 flex-col rounded-2xl p-5">
      <header className="mb-3.5 flex items-baseline justify-between">
        <h2 className="font-display text-[1.5rem] leading-none text-white">Task board</h2>
        <span className="font-mono text-[10.5px] text-white/35">
          {open.length} open · {done.length} done
        </span>
      </header>
      <p className="mb-4 text-[11.5px] leading-snug text-white/40">
        Updates live as the call happens — the shared state the phone and the laptop both act on.
      </p>

      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {open.map((t) => (
          <Card key={t.id} task={t} flash={flashed.includes(t.id)} />
        ))}

        {parked.length > 0 && (
          <>
            <Divider label="Parked" />
            {parked.map((t) => (
              <Card key={t.id} task={t} flash={flashed.includes(t.id)} dim />
            ))}
          </>
        )}

        {done.length > 0 && (
          <>
            <Divider label="Done" />
            {done.map((t) => (
              <Card key={t.id} task={t} flash={flashed.includes(t.id)} dim />
            ))}
          </>
        )}

        {!tasks.length && (
          <p className="py-10 text-center text-[12px] text-white/30">No tasks yet.</p>
        )}
      </div>

      {activity.length > 0 && (
        <footer className="mt-4 border-t border-white/[0.07] pt-3">
          <p className="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/30">
            Changes this call
          </p>
          <ul className="scroll-thin max-h-24 space-y-1.5 overflow-y-auto pr-1">
            {[...activity].reverse().map((a) => (
              <li key={a.id} className="flex animate-slideUp items-start gap-2 text-[11.5px] text-white/60">
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-coral" />
                {a.op.summary}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </section>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-3">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/25">{label}</span>
      <span className="h-px flex-1 bg-white/[0.07]" />
    </div>
  );
}

function Card({ task, flash, dim }: { task: Task; flash: boolean; dim?: boolean }) {
  const isDone = task.status === "done";
  const dot = task.priority === 1 ? "bg-coral" : task.priority === 2 ? "bg-amber" : "bg-white/25";
  const overdue = task.deadline && !isDone && Date.parse(task.deadline) < Date.now();

  return (
    <article
      className={`rounded-xl border px-3.5 py-3 transition-all duration-300 ${
        flash ? "animate-flash border-coral/55" : "border-white/[0.07]"
      } ${dim ? "opacity-45" : ""} bg-white/[0.03]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${isDone ? "bg-mint" : dot}`} />
          <div className="min-w-0">
            <p className={`truncate text-[13px] font-medium ${isDone ? "text-white/50 line-through" : "text-white/90"}`}>
              {task.title}
            </p>
            <p className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-white/38">
              {isDone ? (
                <span className="flex items-center gap-1 text-mint">
                  <CheckIcon className="h-3 w-3" /> done
                </span>
              ) : (
                <span className={`flex items-center gap-1 ${overdue ? "text-rose-400" : ""}`}>
                  <ClockIcon className="h-3 w-3" /> {fmt(task.deadline)}
                </span>
              )}
              <span className="text-white/20">·</span>
              <span>{task.durationMin}m</span>
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9.5px] text-white/45">
          P{task.priority}
        </span>
      </div>
    </article>
  );
}
