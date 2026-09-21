"use client";

/**
 * All sound is synthesised in the browser — no audio assets to ship or to fail
 * to load on a conference-centre network mid-demo.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Classic two-tone ring cadence: 2s of ring, 4s of silence, repeating. */
export function startRingtone(): () => void {
  let stopped = false;
  let timer: number | undefined;

  const burst = () => {
    if (stopped) return;
    const ac = audio();
    const master = ac.createGain();
    master.gain.value = 0.0001;
    master.connect(ac.destination);

    const a = ac.createOscillator();
    const b = ac.createOscillator();
    a.frequency.value = 440;
    b.frequency.value = 480;
    a.type = "sine";
    b.type = "sine";
    a.connect(master);
    b.connect(master);

    const t = ac.currentTime;
    // two 0.4s pulses separated by 0.2s, then quiet
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(0.16, t + 0.04);
    master.gain.setValueAtTime(0.16, t + 0.4);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    master.gain.exponentialRampToValueAtTime(0.16, t + 0.66);
    master.gain.setValueAtTime(0.16, t + 1.06);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 1.14);

    a.start(t);
    b.start(t);
    a.stop(t + 1.2);
    b.stop(t + 1.2);

    timer = window.setTimeout(burst, 3000);
  };

  burst();
  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
  };
}

/** Short confirmation blip when the call connects or drops. */
export function blip(kind: "connect" | "end") {
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  const t = ac.currentTime;
  osc.type = "sine";
  if (kind === "connect") {
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(990, t + 0.12);
  } else {
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.18);
  }
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  osc.start(t);
  osc.stop(t + 0.3);
}

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Pick the least robotic available system voice. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferred = [/google uk english female/i, /samantha/i, /google us english/i, /zira/i, /aria/i, /natural/i];
  for (const re of preferred) {
    const hit = voices.find((v) => re.test(v.name) && v.lang.startsWith("en"));
    if (hit) return hit;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
}

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.04;
    u.pitch = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    // Chrome drops queued utterances if the tab was idle; a tick avoids it.
    window.setTimeout(() => window.speechSynthesis.speak(u), 40);
  });
}

/**
 * Speak a reply: hosted Groq TTS if the model is enabled on the account,
 * otherwise the browser's own synthesis. Either way the caller just awaits.
 */
export async function speakReply(text: string, muted: boolean): Promise<void> {
  if (muted || !text) return;
  stopSpeech();
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 200) {
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
      const el = new Audio(url);
      currentAudio = el;
      await new Promise<void>((resolve) => {
        el.onended = () => resolve();
        el.onerror = () => resolve();
        void el.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      currentAudio = null;
      return;
    }
  } catch {
    /* fall through to browser speech */
  }
  await browserSpeak(text);
}
