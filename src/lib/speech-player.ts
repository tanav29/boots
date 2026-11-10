/** Plays little-endian 24kHz PCM as it arrives; no complete-file buffering. */
export class SpeechPlayer {
  private context: AudioContext | null = null;
  private queue: string[] = [];
  private active = new Set<AudioBufferSourceNode>();
  private abort: AbortController | null = null;
  private nextTime = 0;
  private previousText = "";
  private generation = 0;
  private draining = false;
  private checkTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private onState: (speaking: boolean) => void,
    private onError: (message: string) => void,
  ) {}

  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  enqueue(text: string) {
    this.queue.push(text);
    void this.drain();
  }

  stop() {
    this.generation++;
    this.queue = [];
    this.abort?.abort();
    this.abort = null;
    for (const node of this.active) {
      try {
        node.stop();
      } catch {}
    }
    this.active.clear();
    this.nextTime = 0;
    this.previousText = "";
    this.draining = false;
    clearTimeout(this.checkTimer);
    this.onState(false);
  }

  close() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  private async drain() {
    if (this.draining || !this.context) return;
    this.draining = true;
    const generation = this.generation;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.onState(true);
    try {
      while (this.queue.length && generation === this.generation) {
        const text = this.queue.shift()!;
        const response = await fetch("/api/voice/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, previousText: this.previousText.slice(-600) }),
          signal,
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Voice playback failed.");
        }
        if (!response.body || response.status === 204) continue;
        const reader = response.body.getReader();
        let remainder = new Uint8Array(0);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (generation !== this.generation) break;
            const bytes = new Uint8Array(remainder.length + value.length);
            bytes.set(remainder);
            bytes.set(value, remainder.length);
            const count = Math.floor(bytes.length / 2);
            remainder = bytes.slice(count * 2);
            if (!count) continue;
            const buffer = this.context.createBuffer(1, count, 24000);
            const channel = buffer.getChannelData(0);
            const view = new DataView(bytes.buffer);
            for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
            const node = this.context.createBufferSource();
            node.buffer = buffer;
            node.connect(this.context.destination);
            this.active.add(node);
            node.onended = () => {
              this.active.delete(node);
              node.disconnect();
            };
            this.nextTime = Math.max(this.nextTime, this.context.currentTime + 0.06);
            node.start(this.nextTime);
            this.nextTime += buffer.duration;
            // Bound audio scheduled ahead, preserving stop/barge-in responsiveness.
            while (this.nextTime - this.context.currentTime > 3 && !signal.aborted) {
              await new Promise<void>((resolve) => setTimeout(resolve, 80));
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        this.previousText = text;
      }
    } catch (error) {
      if (!signal.aborted && generation === this.generation) {
        this.stop();
        this.onError(
          error instanceof Error
            ? error.message
            : "Voice playback failed. Text chat is still available.",
        );
      }
    } finally {
      if (generation === this.generation) {
        this.draining = false;
        const delay = Math.max(0, ((this.nextTime || 0) - (this.context?.currentTime || 0)) * 1000);
        this.checkTimer = setTimeout(() => {
          if (!this.draining && !this.queue.length) this.onState(false);
        }, delay + 100);
      }
    }
  }
}
