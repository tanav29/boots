"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { AudioLines, CornerDownLeft, X } from "lucide-react";

type VoiceState = "connecting" | "listening" | "thinking" | "speaking";

const labels: Record<VoiceState, string> = {
  connecting: "Connecting microphone…",
  listening: "Listening to you",
  thinking: "Thinking it through…",
  speaking: "Minimi is speaking",
};

// A stable pattern avoids random server/client markup and keeps motion gentle.
const bars = Array.from({ length: 48 }, (_, index) => {
  const envelope = Math.sin(((index + 0.5) / 48) * Math.PI);
  return {
    "--bar-height": `${8 + envelope * (12 + Math.abs(Math.sin(index * 1.9)) * 30)}px`,
    "--bar-delay": `${-(index * 0.13)}s`,
    "--bar-duration": `${0.65 + (index % 7) * 0.09}s`,
  } as CSSProperties;
});

export function VoiceActivity({
  state,
  transcript,
  onInterrupt,
  onEnd,
}: {
  state: VoiceState;
  transcript: string;
  onInterrupt: () => void;
  onEnd: () => void;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={`voice-activity is-${state}`}>
      <div className="voice-activity-heading">
        <span className="voice-session-label">
          <AudioLines size={16} /> Voice conversation
        </span>
        <span className="voice-timer" role="timer" aria-label="Voice session duration">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="End voice conversation"
          title="End voice conversation"
          onClick={onEnd}
        >
          <X size={17} />
        </button>
      </div>
      <div className="voice-waveform" aria-hidden="true">
        {bars.map((style, index) => (
          <span key={index} style={style} />
        ))}
      </div>
      <p className="voice-state" role="status">
        {labels[state]}
      </p>
      <p className="voice-transcript">
        {state === "listening"
          ? transcript || "Take your time. I’ll respond when you pause."
          : state === "speaking"
            ? "Have something to add? You can interrupt."
            : state === "thinking"
              ? "Your answer is on its way."
              : "Your microphone will be ready in a moment."}
      </p>
      {(state === "thinking" || state === "speaking") && (
        <button type="button" className="voice-interrupt" onClick={onInterrupt}>
          <CornerDownLeft size={14} /> Interrupt
        </button>
      )}
    </div>
  );
}
