"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Push-to-talk recorder. Turn-based by design: the user holds the button, we
 * capture one utterance, release sends it. No barge-in, no VAD — that is the
 * scope decision that keeps the loop reliable on stage.
 *
 * Also exposes a live input level so the call screen can show real waveform
 * movement rather than a decorative animation.
 */
export interface Capture {
  blob: Blob | null;
  /** Loudest input level observed, 0-1. Below ~0.08 nobody spoke. */
  peak: number;
  durationMs: number;
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const analyserRef = useRef<AnalyserRef | null>(null);
  const rafRef = useRef<number | null>(null);
  // Loudest sample seen this capture, plus when it began: together these tell us
  // whether anyone actually spoke, so we never ask Whisper to transcribe silence.
  const peakRef = useRef(0);
  const startedAtRef = useRef(0);

  interface AnalyserRef {
    ctx: AudioContext;
    analyser: AnalyserNode;
    data: Uint8Array<ArrayBuffer>;
  }

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current?.ctx.close().catch(() => {});
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async (): Promise<boolean> => {
    // Guard on the ref, not React state: a fast re-press can arrive before the
    // state from the previous teardown has re-rendered.
    if (recorderRef.current) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyserRef.current = { ctx, analyser, data };

      const tick = () => {
        const a = analyserRef.current;
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

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      peakRef.current = 0;
      startedAtRef.current = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setPermissionError(null);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone unavailable";
      setPermissionError(
        /denied|NotAllowed/i.test(msg)
          ? "Microphone blocked. Allow mic access, or use the type-instead box."
          : msg,
      );
      teardown();
      return false;
    }
  }, [teardown]);

  /**
   * Ask for mic permission early and release it immediately. Called when the
   * call is answered so the browser prompt lands while nothing is waiting on
   * it, rather than in the middle of the user's first sentence.
   */
  const prewarm = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setPermissionError(null);
    } catch {
      // Silent: the real press reports the failure with proper wording.
    }
  }, []);

  /** Stop and hand back the utterance, with the evidence that it contained speech. */
  const stop = useCallback((): Promise<Capture> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      const peak = peakRef.current;
      const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      if (!rec || rec.state === "inactive") {
        setRecording(false);
        teardown();
        return resolve({ blob: null, peak, durationMs });
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        setRecording(false);
        teardown();
        resolve({ blob: blob.size > 0 ? blob : null, peak, durationMs });
      };
      rec.stop();
    });
  }, [teardown]);

  return { recording, level, permissionError, start, stop, prewarm };
}
