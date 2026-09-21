"use client";

import { useCall } from "@/store/useCall";
import { HomeScreen } from "./HomeScreen";
import { InCallScreen } from "./InCallScreen";
import { IncomingCall } from "./IncomingCall";
import { PhoneIcon, RefreshIcon } from "./Icons";

interface Props {
  onCall: () => void;
  onAnswer: () => void;
  onHangUp: () => void;
  onMicDown: () => void;
  onMicUp: () => void;
  onType: (text: string) => void;
  level: number;
  recording: boolean;
  listenMode: "idle" | "hold" | "tap";
  micError: string | null;
}

/** The device shell. Everything inside is 390x844 so it matches a real handset. */
export function Phone(props: Props) {
  const { phase, reset, transcript, activity } = useCall();

  return (
    <div className="device relative h-[844px] w-[390px] shrink-0 overflow-hidden">
      <div className="absolute left-1/2 top-0 z-20 h-[26px] w-[118px] -translate-x-1/2 notch" />

      <div className="relative h-full w-full overflow-hidden rounded-[2.6rem]">
        {phase === "idle" && <HomeScreen onCall={props.onCall} />}

        {phase === "ringing" && (
          <IncomingCall onAnswer={props.onAnswer} onDecline={() => useCall.setState({ phase: "idle" })} />
        )}

        {(phase === "connecting" || phase === "in-call") && (
          <InCallScreen
            level={props.level}
            recording={props.recording}
            listenMode={props.listenMode}
            onMicDown={props.onMicDown}
            onMicUp={props.onMicUp}
            onHangUp={props.onHangUp}
            onType={props.onType}
            micError={props.micError}
          />
        )}

        {phase === "ended" && (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-white/[0.07] text-2xl">📋</div>
            <div>
              <h3 className="font-display text-[1.9rem] leading-none text-white">Call ended</h3>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/45">
                {activity.length
                  ? `${activity.length} change${activity.length === 1 ? "" : "s"} saved across ${transcript.length} turns.`
                  : "Nothing changed this time."}
              </p>
              <p className="mt-1 text-[12px] text-white/30">No app was opened.</p>
            </div>
            <div className="mt-2 flex gap-2.5">
              <button
                onClick={props.onCall}
                className="flex items-center gap-2 rounded-xl bg-coral px-4 py-2.5 text-[12.5px] font-semibold text-[#2a0f07]"
              >
                <PhoneIcon className="h-4 w-4" /> Call again
              </button>
              <button
                onClick={reset}
                className="flex items-center gap-2 rounded-xl bg-white/[0.08] px-4 py-2.5 text-[12.5px] font-medium text-white/75 hover:bg-white/[0.13]"
              >
                <RefreshIcon className="h-4 w-4" /> Reset demo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
