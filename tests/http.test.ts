import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, readJson, sameOrigin } from "../src/server/http";

test("mutations reject cross-origin browser requests", () => {
  assert.throws(
    () =>
      sameOrigin(
        new Request("http://localhost:3000/api/chat", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    /Cross-origin/,
  );
  assert.throws(
    () =>
      sameOrigin(
        new Request("http://localhost:3000/api/chat", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    /Cross-site/,
  );
  assert.doesNotThrow(() =>
    sameOrigin(
      new Request("http://localhost:3000/api/chat", {
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  );
});
test("body limits apply even without a content-length header", async () => {
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(100) }),
  });
  await assert.rejects(readJson(request, 20), /too large/);
});
test("malformed JSON and unsupported content types are rejected", async () => {
  await assert.rejects(
    readJson(new Request("http://localhost", { method: "POST", body: "{}" })),
    /Expected a JSON/,
  );
  await assert.rejects(
    readJson(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ),
    /not valid JSON/,
  );
});
test("rate limits are scoped by owner and request lane", () => {
  rateLimit("test-owner", "chat", 1);
  assert.throws(() => rateLimit("test-owner", "chat", 1), /Too many/);
  assert.doesNotThrow(() => rateLimit("another-owner", "chat", 1));
  assert.doesNotThrow(() => rateLimit("test-owner", "voice", 1));
});
