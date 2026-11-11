"use client";

import { useEffect, useState } from "react";

type VoiceState = "connecting" | "listening" | "thinking" | "speaking";
const quiet = Array<number>(20).fill(0);
const labels: Record<VoiceState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
};

export function VoiceActivity({
  state,
  transcript,
  getTrack,
}: {
  state: VoiceState;
  transcript: string;
  getTrack: () => MediaStreamTrack | undefined;
}) {
  const [wave, setWave] = useState({ levels: quiet, active: false });
  const listening = state === "listening";

  useEffect(() => {
    if (!listening) return;
    let track: MediaStreamTrack | undefined;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    const samples = new Float32Array(256);
    let levels = [...quiet];
    let lastSpeech = 0;
    const cleanup = () => {
      clearInterval(timer);
      source?.disconnect();
      analyser?.disconnect();
      void context?.close().catch(() => {});
      // The transcription SDK owns this track; never stop it here.
    };
    const timer = setInterval(() => {
      if (!analyser) {
        // Scribe may report connected just before exposing its capture track.
        track = getTrack();
        if (!track || track.readyState !== "live") return;
        try {
          const sampleRate = track.getSettings().sampleRate;
          context = new AudioContext(sampleRate ? { sampleRate } : undefined);
          source = context.createMediaStreamSource(new MediaStream([track]));
          analyser = context.createAnalyser();
          analyser.fftSize = samples.length;
          source.connect(analyser);
          void context.resume().catch(() => {});
        } catch {
          // A visualisation failure must not interrupt transcription.
          cleanup();
          return;
        }
      }
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
      );
      const level = track?.enabled ? Math.min(1, Math.max(0, (rms - 0.006) * 14)) : 0;
      if (level > 0.05) lastSpeech = Date.now();
      levels = [...levels.slice(1), level];
      setWave({ levels, active: Date.now() - lastSpeech < 350 });
    }, 50);

    return cleanup;
  }, [listening, getTrack]);

  const active = listening && wave.active;
  return (
    <div className="flex min-h-9 min-w-0 flex-1 items-center gap-3 self-center px-2">
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-500" role="status">
        {listening && transcript ? transcript : labels[state]}
      </span>
      <svg
        viewBox="0 0 100 24"
        className={`h-6 shrink-0 motion-safe:transition-[width] motion-safe:duration-200 ${active ? "w-24 text-violet-600" : "w-10 text-zinc-400"}`}
        aria-hidden="true"
      >
        {(listening ? wave.levels : quiet).map((level, index) => {
          const height = 2 + level * 20;
          return (
            <rect
              key={index}
              x={index * 5 + 1}
              y={(24 - height) / 2}
              width="2"
              height={height}
              rx="1"
              fill="currentColor"
            />
          );
        })}
      </svg>
    </div>
  );
}
