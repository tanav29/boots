import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicTextFilter, SpeechSegmenter, speakable } from "../src/lib/voice-text";

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
