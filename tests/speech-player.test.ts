import { test } from "node:test";
import assert from "node:assert/strict";
import { SpeechPlayer } from "../src/lib/speech-player";

test("PCM playback handles odd byte boundaries and stop aborts audio already scheduled", async () => {
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const originalFetch = globalThis.fetch;
  const channels: Float32Array[] = [];
  const nodes: { stopped: boolean; startAt?: number }[] = [];
  let fetchSignal: AbortSignal | null | undefined;
  let audioReady!: () => void;
  const scheduled = new Promise<void>((resolve) => {
    audioReady = resolve;
  });
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    async resume() {}
    async close() {}
    createBuffer(_channels: number, size: number, rate: number) {
      const channel = new Float32Array(size);
      channels.push(channel);
      return { duration: size / rate, getChannelData: () => channel };
    }
    createBufferSource() {
      const state = { stopped: false, startAt: 0 };
      nodes.push(state);
      return {
        connect() {},
        disconnect() {},
        start(time: number) {
          state.startAt = time;
          if (nodes.length === 2) audioReady();
        },
        stop() {
          state.stopped = true;
        },
        buffer: null,
        onended: null,
      };
    }
  }
  Object.defineProperty(globalThis, "AudioContext", {
    value: FakeAudioContext,
    configurable: true,
  });
  globalThis.fetch = async (_input, init) => {
    fetchSignal = init?.signal;
    // 0, maximum positive, minimum negative PCM samples, split across odd boundaries.
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0, 0, 255]));
          controller.enqueue(new Uint8Array([127, 0, 128]));
          controller.close();
        },
      }),
    );
  };
  const errors: string[] = [];
  const player = new SpeechPlayer(
    () => {},
    (message) => errors.push(message),
  );
  try {
    await player.unlock();
    player.enqueue("The public answer.");
    await scheduled;
    assert.deepEqual(
      channels.flatMap((c) => [...c]),
      [0, 32767 / 32768, -1],
    );
    assert.ok(nodes[0].startAt! >= 0.06);
    player.stop();
    assert.equal(fetchSignal?.aborted, true);
    assert.equal(
      nodes.every((n) => n.stopped),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    player.close();
    globalThis.fetch = originalFetch;
    if (originalContext) Object.defineProperty(globalThis, "AudioContext", originalContext);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  }
});
