import type { BusyBlock, Task } from "./types";

/**
 * Demo seed, built as offsets from "now" rather than fixed clock hours.
 *
 * This matters more than it looks: with hard-coded times ("deck due at 2pm") a
 * run at 4pm opens with every task already overdue and the planner reporting
 * nothing but conflicts. Relative offsets mean the demo looks like a live,
 * mostly-feasible day whenever it is run — while still leaving one genuinely
 * tight item so the scheduler has something real to catch.
 */
/**
 * Where the demo day starts.
 *
 * Offsets hang off this rather than off raw `Date.now()`, because a hackathon
 * gets demoed at midnight as often as at midday — and a seed anchored to "now"
 * at 8pm produces a client deck due at 11:30 PM and standup notes due at
 * 1:30 AM, which undercuts the whole pitch. Inside working hours the anchor is
 * now; outside them it rolls to the next 9am.
 */
const DAY_START = 9;
const DAY_LATEST_ANCHOR = 16;

function anchor(): Date {
  const d = new Date();
  const h = d.getHours();
  if (h >= DAY_START - 1 && h < DAY_LATEST_ANCHOR) return d;
  const next = new Date(d);
  if (h >= DAY_LATEST_ANCHOR) next.setDate(next.getDate() + 1);
  next.setHours(DAY_START, 0, 0, 0);
  return next;
}

/**
 * Offset from the demo anchor, snapped to the quarter hour. The snapping is for
 * the voice: an assistant that says "due at quarter past seven" sounds like an
 * assistant, one that says "due at 7:14" sounds like a database.
 */
function inMin(minutes: number): string {
  const d = new Date(anchor().getTime() + minutes * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15);
  return d.toISOString();
}

function tomorrowAt(hour: number): string {
  const d = anchor();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function seedTasks(): Task[] {
  const created = new Date().toISOString();
  return [
    // Deliberately tight: 90 minutes of work against a ~3 hour horizon that
    // also contains two fixed meetings. This is the one the planner should flag.
    { id: "client-deck", title: "Client deck", deadline: inMin(190), durationMin: 90, priority: 1, status: "open", createdAt: created },
    { id: "priya-follow-up", title: "Reply to Priya's follow-up", deadline: inMin(95), durationMin: 20, priority: 1, status: "open", createdAt: created },
    { id: "standup-notes", title: "Write up standup notes", deadline: inMin(300), durationMin: 25, priority: 2, status: "open", createdAt: created },
    { id: "gym-slot", title: "Book gym slot", deadline: tomorrowAt(11), durationMin: 10, priority: 3, status: "open", createdAt: created },
    { id: "expense-report", title: "File expense report", deadline: null, durationMin: 30, priority: 3, status: "open", createdAt: created },
  ];
}

/** Fixed commitments the planner must work around — this is what makes the plan non-trivial. */
export function seedBusy(): BusyBlock[] {
  return [
    { id: "standup", title: "Team standup", start: inMin(45), end: inMin(75) },
    { id: "design-review", title: "Design review", start: inMin(130), end: inMin(190) },
  ];
}
