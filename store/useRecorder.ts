"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Push-to-talk recorder. Turn-based by design: the user holds (or taps) the
 * button, we capture one utterance, release sends it. No barge-in, no VAD —
 * that is the scope decision that keeps the loop reliable on stage.
 *
 * The mic stream is opened ONCE when the call connects and held for the whole
 * call, rather than acquired per press. That matters for accuracy, not tidiness:
 * getUserMedia plus AudioContext setup costs 100-400ms, and users start talking
 * the instant they press. Acquiring per press silently ate the first word or two
 * of every sentence — and Whisper handed a fragment does not return a fragment,
 * it confidently returns a different sentence. Holding the stream open makes
 * starting the recorder effectively instant.
 */

export interface Capture {
  blob: Blob | null;
  /** Loudest input level observed during this capture, 0-1. */
  peak: number;
  durationMs: number;
  /** Extension matching what the browser actually encoded. */
  ext: string;
}

interface Live {
  stream: MediaStream;
  ctx: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [micOpen, setMicOpen] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const liveRef = useRef<Live | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("");

  /** Open the mic for the duration of the call. Safe to call repeatedly. */
  const openMic = useCallback(async (): Promise<boolean> => {
    if (liveRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      if (ctx.state === "suspended") await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      liveRef.current = { stream, ctx, analyser, data };
      setMicOpen(true);
      setPermissionError(null);

      const tick = () => {
        const a = liveRef.current;
        if (!a) return;
        a.analyser.getByteTimeDomainData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i += 1) {
          const v = (a.data[i] - 128) / 128;
          sum += v * v;
        }
        const lvl = Math.min(1, Math.sqrt(sum / a.data.length) * 3.2);
        if (lvl > peakRef.current) peakRef.current = lvl;
        setLevel(lvl);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone unavailable";
      setPermissionError(
        /denied|NotAllowed|Permission/i.test(msg)
          ? "Microphone blocked. Allow mic access in the address bar, or use the Type button."
          : `Microphone unavailable: ${msg}`,
      );
      return false;
    }
  }, []);

  const closeMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* already stopped */
    }
    recorderRef.current = null;
    chunksRef.current = [];
    const live = liveRef.current;
    liveRef.current = null;
    live?.stream.getTracks().forEach((t) => t.stop());
    live?.ctx.close().catch(() => {});
    setMicOpen(false);
    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => closeMic, [closeMic]);

  /**
   * Begin capturing. The stream is already live, so this is effectively
   * instant — nothing of the user's first word is lost.
   */
  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return false;
    if (!liveRef.current) {
      const ok = await openMic();
      if (!ok) return false;
    }
    const live = liveRef.current;
    if (!live) return false;

    try {
      if (live.ctx.state === "suspended") void live.ctx.resume();
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = mime
        ? new MediaRecorder(live.stream, { mimeType: mime, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(live.stream);

      chunksRef.current = [];
      peakRef.current = 0;
      startedAtRef.current = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      // A timeslice makes the recorder flush periodically, so a capture that
      // ends abruptly still has everything up to that point.
      rec.start(250);
      recorderRef.current = rec;
      setRecording(true);
      setPermissionError(null);
      return true;
    } catch (e) {
      setPermissionError(e instanceof Error ? e.message : "Could not start recording");
      return false;
    }
  }, [openMic]);

  /** Stop and hand back the utterance, with the evidence that it held speech. */
  const stop = useCallback((): Promise<Capture> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      const peak = peakRef.current;
      const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      const ext = extFor(mimeRef.current);

      if (!rec || rec.state === "inactive") {
        recorderRef.current = null;
        setRecording(false);
        return resolve({ blob: null, peak, durationMs, ext });
      }

      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        // The mic stream deliberately stays open, ready for the next turn.
        resolve({ blob: blob.size > 0 ? blob : null, peak, durationMs, ext });
      };
      // Flush whatever is buffered before stopping, so the tail is never clipped.
      try {
        rec.requestData();
      } catch {
        /* not all browsers allow this mid-stop */
      }
      rec.stop();
    });
  }, []);

  return { recording, level, micOpen, permissionError, openMic, closeMic, start, stop };
}
