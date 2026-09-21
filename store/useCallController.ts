"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blip, speakReply, startRingtone, stopSpeech } from "@/lib/audio";
import type { TurnResponse } from "@/lib/types";
import { useCall } from "./useCall";
import { useRecorder } from "./useRecorder";

/**
 * Drives one call end to end: ring, answer, then a turn-based loop of
 * record -> transcribe -> agents -> speak. Turn-based on purpose — no barge-in,
 * so a flaky room mic can never talk over the assistant mid-pitch.
 */

/** Press shorter than this latches recording on (tap-to-talk) instead of ending it. */
const TAP_MS = 400;
/** Hard ceiling on one utterance, so a latched session can never run away. */
const MAX_RECORD_MS = 45_000;
/** Below this peak input level (0-1) the clip is room tone, not speech. */
const SPEECH_PEAK_MIN = 0.08;
/** Anything shorter than this cannot be a usable instruction. */
const MIN_UTTERANCE_MS = 450;

type Capture = "idle" | "starting" | "recording";

export function useCallController() {
  const store = useCall();
  const recorder = useRecorder();
  const stopRing = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);

  /**
   * Mic capture is an explicit state machine rather than a boolean.
   *
   * getUserMedia is async and, on the very first press, sits behind a browser
   * permission prompt for seconds. A plain "is holding" flag lets the release
   * land while the recorder still doesn't exist, which strands the UI in
   * "Listening…" with no way back. Tracking `starting` separately means a
   * release during startup is remembered and applied once the mic is live.
   */
  const captureRef = useRef<Capture>("idle");
  const pressStartRef = useRef(0);
  const releasedDuringStartRef = useRef(false);
  const tapModeRef = useRef(false);
  const maxRecordTimer = useRef<number | null>(null);

  /** Mirrored for rendering: "tap" means recording is latched on. */
  const [listenMode, setListenMode] = useState<"idle" | "hold" | "tap">("idle");

  const { phase, muted } = store;

  // Ringtone lives exactly as long as the ringing phase.
  useEffect(() => {
    if (phase === "ringing") {
      stopRing.current = startRingtone();
    } else {
      stopRing.current?.();
      stopRing.current = null;
    }
    return () => {
      stopRing.current?.();
      stopRing.current = null;
    };
  }, [phase]);

  useEffect(() => () => stopSpeech(), []);

  const say = useCallback(
    async (text: string, viaLaptop?: boolean) => {
      store.addTranscript("assistant", text, viaLaptop);
      store.setVoice("speaking");
      await speakReply(text, muted);
      store.setVoice("idle");
    },
    // store methods are stable zustand setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [muted],
  );

  const resetCapture = useCallback(() => {
    if (maxRecordTimer.current) window.clearTimeout(maxRecordTimer.current);
    maxRecordTimer.current = null;
    captureRef.current = "idle";
    tapModeRef.current = false;
    releasedDuringStartRef.current = false;
    setListenMode("idle");
  }, []);

  const startCall = useCallback(() => {
    resetCapture();
    store.reset();
    store.startRinging();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetCapture]);

  const answer = useCallback(async () => {
    stopRing.current?.();
    blip("connect");
    store.answer();
    // Get the permission dialog out of the way now, not mid-sentence later.
    void recorder.prewarm();

    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: useCall.getState().tasks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Briefing failed");
      useCall.setState({ phase: "in-call", trace: data.trace ?? [] });
      await say(data.greeting);
    } catch (e) {
      useCall.setState({ phase: "in-call" });
      store.setError(e instanceof Error ? e.message : "Could not reach the agent.");
      await say("I'm having trouble reaching my brain right now. You can still tell me what to change.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say, recorder]);

  const hangUp = useCallback(() => {
    stopSpeech();
    void recorder.stop();
    resetCapture();
    blip("end");
    store.hangUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, resetCapture]);

  /** Send one user utterance through the agents and speak the reply. */
  const sendTurn = useCallback(
    async (text: string) => {
      if (!text.trim() || busyRef.current) return;
      busyRef.current = true;

      const s = useCall.getState();
      s.addTranscript("user", text);
      s.setVoice("thinking");
      s.setError(null);
      // UI hint only — the authoritative route comes back on the response.
      if (looksLikeReplan(text)) s.setHandoff(true);

      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            history: useCall.getState().history().slice(0, -1),
            tasks: useCall.getState().tasks,
            busy: useCall.getState().busy,
          }),
        });
        const data = (await res.json()) as TurnResponse & { error?: string };
        if (!res.ok) throw new Error(data?.error || `Turn failed (${res.status})`);

        useCall.getState().applyTurn(data);
        useCall.getState().setHandoff(false);
        await say(data.reply, data.route === "laptop");

        if (data.endCall) {
          blip("end");
          useCall.setState({ phase: "ended" });
        }
      } catch (e) {
        useCall.getState().setHandoff(false);
        useCall.getState().setError(e instanceof Error ? e.message : "Turn failed.");
        await say("Sorry — I didn't catch that. Could you say it again?");
      } finally {
        busyRef.current = false;
      }
    },
    [say],
  );

  /** Close out a capture: stop the mic, transcribe, run the turn. */
  const stopAndSend = useCallback(async () => {
    if (maxRecordTimer.current) window.clearTimeout(maxRecordTimer.current);
    maxRecordTimer.current = null;
    captureRef.current = "idle";
    tapModeRef.current = false;
    setListenMode("idle");

    const { blob, peak, durationMs } = await recorder.stop();
    if (!blob) {
      useCall.getState().setVoice("idle");
      return;
    }

    // Gate on the mic's own energy before spending a network round trip.
    // Whisper does not reliably report "no speech" — handed silence it invents a
    // confident sentence instead, which is how prompt text ended up in the
    // transcript. The fix is simply never to send it silence.
    if (durationMs < MIN_UTTERANCE_MS || peak < SPEECH_PEAK_MIN) {
      useCall.getState().setVoice("idle");
      useCall
        .getState()
        .setError(
          durationMs < MIN_UTTERANCE_MS
            ? "That was too short — hold the mic while you speak, or tap it once and talk."
            : "I couldn't hear you. Check the mic input, speak a little louder, or use the Type button.",
        );
      return;
    }

    useCall.getState().setVoice("thinking");

    try {
      const fd = new FormData();
      fd.append("audio", blob, "speech.webm");
      const res = await fetch("/api/stt", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Transcription failed");

      const text = (data.text || "").trim();
      if (!text) {
        useCall.getState().setVoice("idle");
        useCall
          .getState()
          .setError(
            data.tooShort
              ? "That was too short to hear — hold the mic while you speak, or tap it once and talk."
              : "I didn't hear anything. Try again, or use the Type button.",
          );
        return;
      }
      await sendTurn(text);
    } catch (e) {
      useCall.getState().setVoice("idle");
      useCall.getState().setError(e instanceof Error ? e.message : "Could not transcribe.");
    }
  }, [recorder, sendTurn]);

  const micDown = useCallback(async () => {
    if (busyRef.current) return;

    // Second tap while recording is latched on: that means "send it".
    if (captureRef.current === "recording" && tapModeRef.current) {
      await stopAndSend();
      return;
    }
    if (captureRef.current !== "idle") return;

    captureRef.current = "starting";
    pressStartRef.current = Date.now();
    releasedDuringStartRef.current = false;
    tapModeRef.current = false;
    stopSpeech();
    useCall.getState().setVoice("listening");
    setListenMode("hold");

    const ok = await recorder.start();
    if (!ok) {
      resetCapture();
      useCall.getState().setVoice("idle");
      return;
    }
    captureRef.current = "recording";
    maxRecordTimer.current = window.setTimeout(() => {
      if (captureRef.current === "recording") void stopAndSend();
    }, MAX_RECORD_MS);

    // The mic only came alive after the pointer was already released — usually
    // because the permission prompt ate the press. Treat it as a tap so the
    // user can just keep talking instead of being stranded.
    if (releasedDuringStartRef.current) {
      releasedDuringStartRef.current = false;
      tapModeRef.current = true;
      setListenMode("tap");
    }
  }, [recorder, resetCapture, stopAndSend]);

  const micUp = useCallback(async () => {
    if (captureRef.current === "starting") {
      releasedDuringStartRef.current = true;
      return;
    }
    if (captureRef.current !== "recording") return;
    if (tapModeRef.current) return; // latched on; wait for the next tap

    if (Date.now() - pressStartRef.current < TAP_MS) {
      // A tap, not a hold — keep listening until they tap again.
      tapModeRef.current = true;
      setListenMode("tap");
      return;
    }
    await stopAndSend();
  }, [stopAndSend]);

  return {
    ...store,
    recorder,
    listenMode,
    startCall,
    answer,
    hangUp,
    sendTurn,
    micDown,
    micUp,
  };
}

/** Cheap client-side guess used only to light the "laptop" indicator while waiting. */
function looksLikeReplan(text: string): boolean {
  return /\b(replan|re-plan|reorganis|reorganiz|reschedule everything|plan my|rest of (my|the) day|whole (day|week)|what should i do|prioriti[sz]e my|sort out my day|optimi[sz]e)\b/i.test(
    text,
  );
}
