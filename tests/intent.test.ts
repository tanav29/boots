import { test } from "node:test";
import assert from "node:assert/strict";
import { isSmallTalk } from "../src/server/intent";

test("fast path never catches a factual question appended to a greeting", () => {
  assert.equal(isSmallTalk("Hello!"), true);
  assert.equal(isSmallTalk("Thank you."), true);
  assert.equal(isSmallTalk("नमस्ते"), true);
  assert.equal(isSmallTalk("Hello, what is Neon pricing today?"), false);
  assert.equal(isSmallTalk("Thanks! Has that changed?"), false);
  assert.equal(isSmallTalk("What did I ask last Tuesday?"), false);
});
