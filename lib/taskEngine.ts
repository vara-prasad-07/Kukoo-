import type { BusyBlock, Priority, Task, TaskOp, TaskStatus } from "./types";

/**
 * The task engine is deliberately dumb and deterministic. The dialogue agent may
 * only change the task list by calling these functions, so every mutation the
 * user hears about on the call is one the board can show and replay.
 */

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";

export function newId(title: string, existing: Task[]): string {
  const base = slug(title);
  if (!existing.some((t) => t.id === base)) return base;
  let n = 2;
  while (existing.some((t) => t.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Resolve whatever the model handed us to a real task. Models routinely invent
 * ids from the title ("client-deck") or pass the title itself, so we match on id,
 * then exact title, then fuzzy token overlap before giving up.
 */
export function resolveTask(tasks: Task[], ref: string): Task | null {
  if (!ref) return null;
  const needle = ref.trim().toLowerCase();
  const byId = tasks.find((t) => t.id.toLowerCase() === needle);
  if (byId) return byId;
  const byTitle = tasks.find((t) => t.title.toLowerCase() === needle);
  if (byTitle) return byTitle;
  const bySlug = tasks.find((t) => slug(t.title) === slug(needle));
  if (bySlug) return bySlug;
  const contains = tasks.filter(
    (t) => t.title.toLowerCase().includes(needle) || needle.includes(t.title.toLowerCase()),
  );
  if (contains.length === 1) return contains[0];

  const words = needle.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: Task | null = null;
  let bestScore = 0;
  for (const t of tasks) {
    const hay = `${t.title} ${t.id}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore > 0 ? best : (contains[0] ?? null);
}

const clampPriority = (n: number): Priority => (n <= 1 ? 1 : n >= 3 ? 3 : 2);

/**
 * Turn loose natural-language time refs into a concrete ISO datetime.
 * The model is asked for ISO, but on a voice call it often replies "tomorrow
 * morning" — handling that here keeps the engine authoritative over the clock.
 */
export function parseWhen(when: string, now = new Date()): string | null {
  if (!when) return null;
  const raw = when.trim();
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct) && /\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(direct).toISOString();

  const s = raw.toLowerCase();
  const d = new Date(now);
  const atTime = (base: Date, h: number, m = 0) => {
    const x = new Date(base);
    x.setHours(h, m, 0, 0);
    return x;
  };

  const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hour: number | null = null;
  let minute = 0;
  if (timeMatch) {
    const h = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const mer = timeMatch[3];
    if (mer === "pm") hour = h === 12 ? 12 : h + 12;
    else if (mer === "am") hour = h === 12 ? 0 : h;
    else if (h >= 0 && h <= 23) hour = h;
  }
  if (/morning/.test(s)) hour = hour ?? 9;
  if (/afternoon/.test(s)) hour = hour ?? 14;
  if (/evening|tonight/.test(s)) hour = hour ?? 19;

  if (/day after tomorrow/.test(s)) d.setDate(d.getDate() + 2);
  else if (/tomorrow/.test(s)) d.setDate(d.getDate() + 1);
  else if (/next week/.test(s)) d.setDate(d.getDate() + 7);
  else if (/today|this (morning|afternoon|evening)|tonight|later/.test(s)) {
    /* same day */
  } else {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const idx = days.findIndex((n) => s.includes(n));
    if (idx >= 0) {
      let delta = (idx - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
    } else if (hour === null) {
      return null;
    }
  }
  return atTime(d, hour ?? 17, minute).toISOString();
}

export interface EngineResult {
  tasks: Task[];
  op: TaskOp | null;
  /** What the agent gets told happened, fed back into the tool loop. */
  message: string;
}

export function addTask(
  tasks: Task[],
  input: { title: string; when?: string; durationMin?: number; priority?: number; notes?: string },
  now = new Date(),
): EngineResult {
  const title = (input.title || "").trim();
  if (!title) return { tasks, op: null, message: "Rejected: a task needs a title." };

  const dup = tasks.find((t) => t.title.toLowerCase() === title.toLowerCase() && t.status === "open");
  if (dup) return { tasks, op: null, message: `Already on the list as "${dup.title}" — nothing added.` };

  const task: Task = {
    id: newId(title, tasks),
    title,
    deadline: input.when ? parseWhen(input.when, now) : null,
    durationMin: Math.max(5, Math.round(input.durationMin ?? 30)),
    priority: clampPriority(input.priority ?? 2),
    status: "open",
    notes: input.notes,
    createdAt: now.toISOString(),
  };
  return {
    tasks: [...tasks, task],
    op: { kind: "add", taskId: task.id, title: task.title, summary: `Added "${task.title}"`, after: task },
    message: `Added "${task.title}"${task.deadline ? ` due ${fmt(task.deadline)}` : " with no deadline"} (${task.durationMin} min).`,
  };
}

export function completeTask(tasks: Task[], ref: string): EngineResult {
  const t = resolveTask(tasks, ref);
  if (!t) return { tasks, op: null, message: `No task matching "${ref}".` };
  if (t.status === "done") return { tasks, op: null, message: `"${t.title}" was already done.` };
  return {
    tasks: tasks.map((x) => (x.id === t.id ? { ...x, status: "done" as TaskStatus } : x)),
    op: {
      kind: "complete",
      taskId: t.id,
      title: t.title,
      summary: `Marked "${t.title}" done`,
      before: { status: t.status },
      after: { status: "done" },
    },
    message: `Marked "${t.title}" done.`,
  };
}

export function rescheduleTask(tasks: Task[], ref: string, when: string, now = new Date()): EngineResult {
  const t = resolveTask(tasks, ref);
  if (!t) return { tasks, op: null, message: `No task matching "${ref}".` };
  const iso = parseWhen(when, now);
  if (!iso) {
    return {
      tasks,
      op: null,
      message: `Could not read "${when}" as a time. Ask the user for a clearer day or time.`,
    };
  }
  return {
    tasks: tasks.map((x) => (x.id === t.id ? { ...x, deadline: iso, status: "open" as TaskStatus } : x)),
    op: {
      kind: "reschedule",
      taskId: t.id,
      title: t.title,
      summary: `Moved "${t.title}" to ${fmt(iso)}`,
      before: { deadline: t.deadline },
      after: { deadline: iso },
    },
    message: `Moved "${t.title}" to ${fmt(iso)}.`,
  };
}

export function setPriority(tasks: Task[], ref: string, priority: number): EngineResult {
  const t = resolveTask(tasks, ref);
  if (!t) return { tasks, op: null, message: `No task matching "${ref}".` };
  const p = clampPriority(priority);
  return {
    tasks: tasks.map((x) => (x.id === t.id ? { ...x, priority: p } : x)),
    op: {
      kind: "priority",
      taskId: t.id,
      title: t.title,
      summary: `"${t.title}" set to P${p}`,
      before: { priority: t.priority },
      after: { priority: p },
    },
    message: `"${t.title}" is now priority ${p}.`,
  };
}

export function deleteTask(tasks: Task[], ref: string): EngineResult {
  const t = resolveTask(tasks, ref);
  if (!t) return { tasks, op: null, message: `No task matching "${ref}".` };
  return {
    tasks: tasks.filter((x) => x.id !== t.id),
    op: { kind: "delete", taskId: t.id, title: t.title, summary: `Dropped "${t.title}"`, before: t },
    message: `Dropped "${t.title}" from the list.`,
  };
}

export function deferTask(tasks: Task[], ref: string): EngineResult {
  const t = resolveTask(tasks, ref);
  if (!t) return { tasks, op: null, message: `No task matching "${ref}".` };
  return {
    tasks: tasks.map((x) => (x.id === t.id ? { ...x, status: "deferred" as TaskStatus } : x)),
    op: {
      kind: "defer",
      taskId: t.id,
      title: t.title,
      summary: `Parked "${t.title}"`,
      before: { status: t.status },
      after: { status: "deferred" },
    },
    message: `Parked "${t.title}" — off today's plan, still on the list.`,
  };
}

export function fmt(iso: string | null): string {
  if (!iso) return "no deadline";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

/** Compact view of state handed to the language models each turn. */
export function describeTasks(tasks: Task[]): string {
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  const deferred = tasks.filter((t) => t.status === "deferred");
  const line = (t: Task) => `- [${t.id}] "${t.title}" | due ${fmt(t.deadline)} | ${t.durationMin}min | P${t.priority}`;
  const parts = [`OPEN (${open.length}):`, ...(open.length ? open.map(line) : ["  (none)"])];
  if (done.length) parts.push(`DONE (${done.length}): ${done.map((t) => t.title).join(", ")}`);
  if (deferred.length) parts.push(`PARKED (${deferred.length}): ${deferred.map((t) => t.title).join(", ")}`);
  return parts.join("\n");
}

export function describeCalendar(busy: BusyBlock[]): string {
  if (!busy.length) return "Calendar: clear.";
  const t = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Calendar (fixed, cannot move):\n${busy.map((b) => `- ${b.title} ${t(b.start)}-${t(b.end)}`).join("\n")}`;
}
