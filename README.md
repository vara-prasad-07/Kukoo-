# RingList — the to-do list that calls you

Round-1 demo build for the iQOO Hackathon 2026 Productivity track.

Instead of a list that waits to be opened, the assistant initiates contact. The phone
shows a full-screen incoming call from "Your Tasks", you answer, and you change your day
by talking. The task board updates live as you speak.

This is the **web demo** of the phone concept: a mobile-shaped call UI in the browser, so
it can be shown on a laptop before the Android build exists. Every piece maps 1:1 to the
on-device architecture in the team spec.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env` needs one key:

```
GROQ_API_KEY=gsk_...
```

Then: **Simulate today's call** → slide to answer → hold the mic and talk
(or tap it once, talk, and tap again to send).

> Use Chrome or Edge. Mic capture needs `localhost` or HTTPS.
> No microphone? Every turn also works through the **Aa** (type) button on the call
> screen, or the "Try saying" buttons on the left — same agent pipeline either way.

---

## How a turn flows

```
hold mic ──▶ Whisper ──▶ Dialogue agent ──▶ Task engine ──▶ speak reply
                         (gpt-oss-20b)      (deterministic)
                              │
                              │ request_replan  ← only for whole-day restructuring
                              ▼
                         Planner agent ──▶ EDF scheduler ──▶ narrated back
                         (gpt-oss-120b)     (no model)
```

| Piece | Where | What it is |
|---|---|---|
| STT | `lib/groq.ts` | `whisper-large-v3-turbo`, ~350ms |
| Dialogue agent | `lib/agents/dialogue.ts` | Small model, tool-calling, holds the conversation |
| Task engine | `lib/taskEngine.ts` | Pure functions. The **only** path from model to state |
| Scheduler | `lib/agents/scheduler.ts` | EDF + time-boxing. **No model runs here** |
| Planner agent | `lib/agents/planner.ts` | Heavy model, narrates what the scheduler decided |
| Briefing agent | `lib/agents/brief.ts` | The opening line when you answer |
| TTS | `lib/audio.ts` | Groq Orpheus if enabled, else browser speech |

### Mapping to the on-device architecture

| Spec | Here |
|---|---|
| On-device small model | `gpt-oss-20b` — the dialogue + edit path |
| Laptop compute over Office Kit | `gpt-oss-120b` — reached only via `request_replan` |
| On-device task store | `lib/taskEngine.ts` |
| Simulated call UI | `components/IncomingCall.tsx` |
| Turn-based voice loop | `store/useRecorder.ts` — push-to-talk, no barge-in |

The routing decision is real, not decorative: a single edit never leaves the device path,
and the **Agent pipeline** panel shows which route the turn actually took, per hop, in ms.

---

## The planning algorithm

"Optimal" has to mean something, so the schedule is computed, not generated.
`buildPlan()` in `lib/agents/scheduler.ts`:

1. **Free slots** = working window minus fixed calendar blocks.
2. **Earliest-deadline-first ordering.** EDF is optimal for feasibility on a single
   resource — if any ordering meets every deadline, EDF does. Priority breaks ties,
   then shorter-duration-first so quick wins aren't stuck behind long blocks.
3. **Greedy time-boxing** into the earliest capacity, splitting a task across gaps when
   it's longer than the slot it lands in (min 15-min chunks, no slivers).
4. **Slack check.** Anything finishing after its deadline is reported as a conflict with
   the exact shortfall in minutes — never silently moved or dropped.

The heavy model is explicitly forbidden from reordering the result; it only reads it out.
The **Laptop planner** panel prints the scheduler's own trace next to the timeline, so you
can show a judge that a scheduler produced the plan.

Edge cases covered: over-capacity days, tasks with no deadline (sort last, not first),
splitting across meetings, empty lists, and demos run late in the evening (the window
rolls into tomorrow's working hours instead of reporting that nothing fits).

---

## Demo notes

- **Seed data is relative to now**, not fixed clock hours — so the demo looks like a live,
  mostly-feasible day whenever it's run, while keeping one genuinely tight item for the
  scheduler to catch. Reset from the end-of-call screen.
- **Rate limits.** Groq's free tier is 8k tokens/minute, which a two-round tool loop can
  exhaust. `lib/groq.ts` backs off using Groq's own suggested retry delay and retries
  up to 3 times, rather than dropping a turn on stage.
- **Silence never reaches Whisper.** Handed a silent clip, Whisper invents a
  confident sentence — including echoing its own vocabulary prompt back as if the user
  had said it. The recorder gates on measured mic energy before sending, and a
  server-side filter catches the known subtitle-corpus artifacts ("Thank you.",
  "Subtitles by the Amara.org community") as a second line of defence.
- **Better voice (optional).** Hosted TTS uses Orpheus, which needs a one-time terms
  acceptance at [console.groq.com](https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english).
  Until then it falls back to browser speech automatically — nothing breaks either way.

### Suggested 4-turn run

1. "What's left for today?" — stays on-device
2. "Push the client deck to tomorrow morning" — watch the board update mid-sentence
3. "Replan my afternoon" — pipeline lights up the laptop route, timeline draws in
4. "Thanks, that's all" — assistant hangs up on its own

---

## Optional env

Only `GROQ_API_KEY` is required. Model choice is overridable:

```
GROQ_DIALOGUE_MODEL=openai/gpt-oss-20b
GROQ_PLANNER_MODEL=openai/gpt-oss-120b
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
```
