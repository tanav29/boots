import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelStream } from "../src/server/providers/openrouter";
import { PublicTextFilter, SpeechSegmenter, speakable } from "../src/lib/voice-text";

function chunked(text: string, size = 3) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}
test("SSE handles arbitrary chunk boundaries, comments, Unicode, and usage without leaking reasoning or tools", async () => {
  const stream = [
    ": heartbeat\n\n",
    'data: {"choices":[{"delta":{"reasoning":"SECRET THOUGHT","tool_calls":[{"name":"web_search"}]}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Hello नमस्ते"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":9}}\n\n',
    "data: [DONE]\n\n",
  ].join("");
  const output = [];
  for await (const event of parseModelStream(chunked(stream))) output.push(event);
  assert.deepEqual(output, [
    { text: "Hello नमस्ते" },
    { usage: { prompt_tokens: 5, completion_tokens: 9 } },
  ]);
  assert.equal(JSON.stringify(output).includes("SECRET"), false);
});
test("a dropped or provider-error stream cannot be mistaken for a completed answer", async () => {
  await assert.rejects(async () => {
    for await (const event of parseModelStream(
      chunked('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'),
    ))
      void event;
  }, /before the answer finished/);
  await assert.rejects(async () => {
    for await (const event of parseModelStream(
      chunked('data: {"error":{"message":"provider secret"}}\n\n'),
    ))
      void event;
  }, /connection failed/);
});
test("split reasoning tags are suppressed even if a model embeds them in content", () => {
  const filter = new PublicTextFilter();
  const output = [
    filter.push("<thi"),
    filter.push("nk>secret"),
    filter.push(" thought</th"),
    filter.push("ink>The answer is 42."),
    filter.push("", true),
  ].join("");
  assert.equal(output, "The answer is 42.");
  assert.equal(new PublicTextFilter().push("<analysis>never speak this", true), "");
});
test("speech removes citations, URLs, Markdown, and fenced code", () => {
  assert.equal(
    speakable("**Neon** costs $19. [S1] [Pricing](https://example.com)"),
    "Neon costs $19. Pricing",
  );
  const s = new SpeechSegmenter();
  const output = [
    ...s.push("Hello. Here is code:\n``"),
    ...s.push("`js\nsecret();\n```\nThe answer is [on this page](https://example.com).\n"),
    ...s.push("", true),
  ].join(" ");
  assert.equal(output.includes("secret"), false);
  assert.equal(output.includes("example.com"), false);
  assert.equal(output.includes("Hello."), true);
  assert.equal(output.includes("on this page"), true);
});
