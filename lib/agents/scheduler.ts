import type { BusyBlock, PlanConflict, PlanResult, ScheduledBlock, Task } from "../types";

/**
 * The scheduler. This is the part that makes "optimal plan" mean something:
 * no model runs here at all. The heavy model downstream only narrates what this
 * function decided.
 *
 * Method — earliest-deadline-first with slack-based risk detection:
 *   1. Compute free slots = working window minus fixed calendar blocks.
 *   2. Order open tasks by EDF (earliest deadline first). EDF is optimal for
 *      feasibility on a single resource: if any ordering meets every deadline,
 *      EDF does. Priority breaks ties between equal deadlines, then shorter
 *      duration first so quick wins are not stuck behind long blocks.
 *   3. Greedily time-box each task into the earliest free capacity, splitting
 *      across slots when a task is longer than the gap it lands in.
 *   4. A task whose placement finishes after its deadline is reported as a
 *      conflict with the exact shortfall, rather than being silently moved.
 */

const MIN_CHUNK = 15; // don't fragment work into slivers shorter than this

interface Slot {
  start: number;
  end: number;
}

function freeSlots(windowStart: number, windowEnd: number, busy: BusyBlock[]): Slot[] {
  const blocks = busy
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter((b) => b.end > windowStart && b.start < windowEnd)
    .sort((a, b) => a.start - b.start);

  const slots: Slot[] = [];
  let cursor = windowStart;
  for (const b of blocks) {
    if (b.start > cursor) slots.push({ start: cursor, end: Math.min(b.start, windowEnd) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < windowEnd) slots.push({ start: cursor, end: windowEnd });
  return slots.filter((s) => s.end - s.start >= MIN_CHUNK * 60_000);
}

function orderEDF(tasks: Task[], horizonEnd: number): Task[] {
  return [...tasks].sort((a, b) => {
    // Tasks with no deadline sort to the back of the queue, not the front.
    const da = a.deadline ? Date.parse(a.deadline) : horizonEnd + 86_400_000;
    const db = b.deadline ? Date.parse(b.deadline) : horizonEnd + 86_400_000;
    if (da !== db) return da - db;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.durationMin - b.durationMin;
  });
}

export interface ScheduleInput {
  tasks: Task[];
  busy: BusyBlock[];
  now: Date;
  /** How far ahead to plan, in hours. */
  horizonHours?: number;
  /** Local hour work can start / must stop. */
  dayStartHour?: number;
  dayEndHour?: number;
}

export function buildPlan(input: ScheduleInput): PlanResult {
  const { tasks, busy, now } = input;
  const horizonHours = input.horizonHours ?? 12;
  const dayEndHour = input.dayEndHour ?? 21;
  const dayStartHour = input.dayStartHour ?? 9;



  const trace: string[] = [];
  const hhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Never schedule work before the day officially starts — running the demo at
  // 3am should not produce a plan that has you writing a deck at 3am.
  const todayStart = new Date(now);
  todayStart.setHours(dayStartHour, 0, 0, 0);
  let start = Math.max(now.getTime(), todayStart.getTime());

  const todayEnd = new Date(now);
  todayEnd.setHours(dayEndHour, 0, 0, 0);
  let end = Math.min(todayEnd.getTime(), start + horizonHours * 3_600_000);

  // Run the demo at 9pm and there is no day left to plan into. Roll the window
  // to tomorrow's working hours rather than reporting that nothing fits.
  const MIN_WINDOW_MS = 120 * 60_000;
  if (end - start < MIN_WINDOW_MS) {
    const nextStart = new Date(now);
    nextStart.setDate(nextStart.getDate() + 1);
    nextStart.setHours(dayStartHour, 0, 0, 0);
    const nextEnd = new Date(nextStart);
    nextEnd.setHours(dayEndHour, 0, 0, 0);
    start = nextStart.getTime();
    end = Math.min(nextEnd.getTime(), start + horizonHours * 3_600_000);
    trace.push(`Too little of today left — planning into tomorrow from ${hhmm(start)}.`);
  }

  const open = tasks.filter((t) => t.status === "open");
  trace.push(`Window ${hhmm(start)} to ${hhmm(end)} · ${open.length} open task(s) · ${busy.length} fixed block(s)`);

  const slots = freeSlots(start, end, busy);
  const capacityMin = Math.round(slots.reduce((a, s) => a + (s.end - s.start), 0) / 60_000);
  trace.push(
    `Free capacity: ${capacityMin} min across ${slots.length} gap(s) — ${slots.map((s) => `${hhmm(s.start)}-${hhmm(s.end)}`).join(", ") || "none"}`,
  );

  const demandMin = open.reduce((a, t) => a + t.durationMin, 0);
  trace.push(`Demand: ${demandMin} min. ${demandMin > capacityMin ? `Over capacity by ${demandMin - capacityMin} min — lowest-priority work will be flagged.` : "Fits inside the window."}`);

  const ordered = orderEDF(open, end);
  trace.push(`EDF order: ${ordered.map((t) => t.title).join(" -> ") || "(nothing to order)"}`);

  const cursors = slots.map((s) => s.start);
  const blocks: ScheduledBlock[] = [];
  const conflicts: PlanConflict[] = [];

  for (const task of ordered) {
    let remaining = task.durationMin * 60_000;
    let placedAny = false;
    let lastEnd = 0;

    for (let i = 0; i < slots.length && remaining > 0; i += 1) {
      const avail = slots[i].end - cursors[i];
      if (avail < MIN_CHUNK * 60_000) continue;
      const take = Math.min(avail, remaining);
      const bStart = cursors[i];
      const bEnd = bStart + take;
      blocks.push({
        taskId: task.id,
        title: task.title,
        start: new Date(bStart).toISOString(),
        end: new Date(bEnd).toISOString(),
        continuation: placedAny,
      });
      cursors[i] = bEnd;
      remaining -= take;
      lastEnd = bEnd;
      placedAny = true;
    }

    if (remaining > 0) {
      conflicts.push({
        taskId: task.id,
        title: task.title,
        reason: placedAny
          ? "Only partly fits in the remaining window."
          : "No free gap left in the window.",
        shortfallMin: Math.round(remaining / 60_000),
      });
      trace.push(`! "${task.title}" short by ${Math.round(remaining / 60_000)} min — flagged, not silently dropped.`);
    } else if (task.deadline && lastEnd > Date.parse(task.deadline)) {
      const over = Math.round((lastEnd - Date.parse(task.deadline)) / 60_000);
      conflicts.push({
        taskId: task.id,
        title: task.title,
        reason: `Finishes ${over} min after its ${hhmm(Date.parse(task.deadline))} deadline.`,
        shortfallMin: over,
      });
      trace.push(`! "${task.title}" lands past deadline by ${over} min.`);
    } else {
      trace.push(`OK "${task.title}" -> ${hhmm(Date.parse(blocks.filter((b) => b.taskId === task.id)[0].start))} (${task.durationMin} min)`);
    }
  }

  const bookedMin = Math.round(
    blocks.reduce((a, b) => a + (Date.parse(b.end) - Date.parse(b.start)), 0) / 60_000,
  );
  const utilizationPct = capacityMin > 0 ? Math.round((bookedMin / capacityMin) * 100) : 0;
  trace.push(`Booked ${bookedMin}/${capacityMin} min (${utilizationPct}% utilization), ${conflicts.length} conflict(s).`);

  blocks.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return {
    blocks,
    conflicts,
    trace,
    horizonStart: new Date(start).toISOString(),
    horizonEnd: new Date(end).toISOString(),
    utilizationPct,
  };
}

/** Flatten a plan into the compact text the narrating model reads back. */
export function describePlan(plan: PlanResult): string {
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const lines = plan.blocks.map(
    (b) => `${t(b.start)}-${t(b.end)} ${b.title}${b.continuation ? " (continued)" : ""}`,
  );
  const out = [`SCHEDULE (computed, do not reorder):`, ...(lines.length ? lines : ["(empty)"])];
  if (plan.conflicts.length) {
    out.push(`CONFLICTS: ${plan.conflicts.map((c) => `${c.title} — ${c.reason}`).join("; ")}`);
  }
  out.push(`Utilization ${plan.utilizationPct}%.`);
  return out.join("\n");
}
