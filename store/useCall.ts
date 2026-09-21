"use client";

import { create } from "zustand";
import { seedBusy, seedTasks } from "@/lib/seed";
import type { AgentTrace, BusyBlock, ChatMessage, PlanResult, Task, TaskOp, TurnResponse } from "@/lib/types";

export type CallPhase = "idle" | "ringing" | "connecting" | "in-call" | "ended";
export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export interface Transcript {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Set on assistant turns that were answered by the laptop planner. */
  viaLaptop?: boolean;
}

export interface ActivityEntry {
  id: string;
  op: TaskOp;
  at: number;
}

interface CallStore {
  phase: CallPhase;
  voice: VoiceState;
  tasks: Task[];
  busy: BusyBlock[];
  transcript: Transcript[];
  activity: ActivityEntry[];
  plan: PlanResult | null;
  trace: AgentTrace[];
  route: "on-device" | "laptop";
  handoffActive: boolean;
  error: string | null;
  /** Task ids to flash on the board because they just changed. */
  flashed: string[];
  muted: boolean;

  startRinging: () => void;
  answer: () => void;
  hangUp: () => void;
  reset: () => void;

  setVoice: (v: VoiceState) => void;
  setError: (e: string | null) => void;
  setHandoff: (v: boolean) => void;
  toggleMute: () => void;

  addTranscript: (role: "user" | "assistant", text: string, viaLaptop?: boolean) => void;
  applyTurn: (r: TurnResponse) => void;
  clearFlash: () => void;
  history: () => ChatMessage[];
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const useCall = create<CallStore>((set, get) => ({
  phase: "idle",
  voice: "idle",
  tasks: seedTasks(),
  busy: seedBusy(),
  transcript: [],
  activity: [],
  plan: null,
  trace: [],
  route: "on-device",
  handoffActive: false,
  error: null,
  flashed: [],
  muted: false,

  startRinging: () => set({ phase: "ringing", error: null }),
  answer: () => set({ phase: "connecting" }),
  hangUp: () => set({ phase: "ended", voice: "idle", handoffActive: false }),

  reset: () =>
    set({
      phase: "idle",
      voice: "idle",
      tasks: seedTasks(),
      busy: seedBusy(),
      transcript: [],
      activity: [],
      plan: null,
      trace: [],
      route: "on-device",
      handoffActive: false,
      error: null,
      flashed: [],
    }),

  setVoice: (voice) => set({ voice }),
  setError: (error) => set({ error }),
  setHandoff: (handoffActive) => set({ handoffActive }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),

  addTranscript: (role, text, viaLaptop) =>
    set((s) => ({ transcript: [...s.transcript, { id: uid(), role, text, at: Date.now(), viaLaptop }] })),

  applyTurn: (r) =>
    set((s) => ({
      tasks: r.tasks,
      plan: r.plan ?? s.plan,
      trace: r.trace,
      route: r.route,
      activity: [...s.activity, ...r.ops.map((op) => ({ id: uid(), op, at: Date.now() }))],
      flashed: r.ops.map((o) => o.taskId),
      phase: r.endCall ? "ended" : s.phase,
    })),

  clearFlash: () => set({ flashed: [] }),

  history: () => get().transcript.map((t) => ({ role: t.role, content: t.text })),
}));
