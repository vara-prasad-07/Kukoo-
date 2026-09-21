"use client";

import { useCall } from "@/store/useCall";
import type { PlanResult } from "@/lib/types";
import { AlertIcon, LaptopIcon } from "./Icons";

/**
 * The laptop side of the handoff. Deliberately shows the algorithm's own trace
 * next to the timeline: the point being made is that a scheduler produced this,
 * and the model only read it out.
 */
export function PlanPanel() {
  const { plan, busy, handoffActive } = useCall();

  if (!plan) {
    return (
      <section className="glass rounded-2xl p-5">
        <Header active={handoffActive} />
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="max-w-[22rem] text-[11.5px] leading-relaxed text-white/35">
            Idle. Ask for a whole-day reorganisation on the call — &ldquo;replan my
            afternoon&rdquo; — and the phone hands the task data over here for the heavy model to
            recompute.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass rounded-2xl p-5">
      <Header active={handoffActive} />
      <Timeline plan={plan} busyCount={busy.length} />

      {plan.conflicts.length > 0 && (
        <ul className="mb-3.5 space-y-1.5">
          {plan.conflicts.map((c) => (
            <li
              key={c.taskId}
              className="flex items-start gap-2 rounded-lg bg-amber/10 px-3 py-2 text-[11.5px] leading-snug text-amber"
            >
              <AlertIcon className="mt-[1px] h-3.5 w-3.5 shrink-0" />
              <span>
                <strong className="font-semibold">{c.title}</strong> — {c.reason}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="group" open>
        <summary className="cursor-pointer list-none text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/30 hover:text-white/50">
          Scheduler trace · EDF + time-boxing
        </summary>
        <pre className="scroll-thin mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/35 p-3 font-mono text-[10.5px] leading-relaxed text-white/55">
          {plan.trace.join("\n")}
        </pre>
      </details>
    </section>
  );
}

function Header({ active }: { active: boolean }) {
  return (
    <header className="mb-3.5 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-[1.5rem] leading-none text-white">
        <LaptopIcon className="h-[18px] w-[18px] text-sky" />
        Laptop planner
      </h2>
      <span
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] ${
          active ? "bg-sky/15 text-sky" : "bg-white/[0.06] text-white/35"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-sky" : "bg-white/25"}`} />
        {active ? "computing" : "office kit"}
      </span>
    </header>
  );
}

function Timeline({ plan, busyCount }: { plan: PlanResult; busyCount: number }) {
  const start = Date.parse(plan.horizonStart);
  const end = Date.parse(plan.horizonEnd);
  const span = Math.max(1, end - start);
  const pct = (ms: number) => ((ms - start) / span) * 100;
  const hhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex justify-between font-mono text-[10px] text-white/30">
        <span>{hhmm(start)}</span>
        <span>
          {plan.utilizationPct}% used · {busyCount} fixed
        </span>
        <span>{hhmm(end)}</span>
      </div>

      <div className="timeline-grid relative mb-3 h-9 overflow-hidden rounded-lg bg-black/30">
        {plan.blocks.map((b, i) => {
          const s = Date.parse(b.start);
          const e = Date.parse(b.end);
          return (
            <div
              key={`${b.taskId}-${i}`}
              title={`${b.title} · ${hhmm(s)}–${hhmm(e)}`}
              className="absolute top-1 h-7 overflow-hidden rounded-md border border-coral/40 bg-coral/25 px-1.5 py-1 animate-slideUp"
              style={{
                left: `${pct(s)}%`,
                width: `${Math.max(1.5, pct(e) - pct(s))}%`,
                animationDelay: `${i * 55}ms`,
              }}
            >
              <span className="block truncate text-[9.5px] font-medium leading-tight text-white/85">
                {b.continuation ? "↳ " : ""}
                {b.title}
              </span>
            </div>
          );
        })}
      </div>

      <ol className="space-y-1">
        {plan.blocks.map((b, i) => (
          <li
            key={`${b.taskId}-row-${i}`}
            className="flex items-center gap-3 text-[11.5px] animate-slideUp"
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <span className="w-[6.5rem] shrink-0 font-mono text-[10.5px] text-white/40">
              {hhmm(Date.parse(b.start))}–{hhmm(Date.parse(b.end))}
            </span>
            <span className="truncate text-white/75">
              {b.continuation && <span className="text-white/35">↳ </span>}
              {b.title}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
