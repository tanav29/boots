import { test } from "node:test";
import assert from "node:assert/strict";
import { research } from "../src/server/providers/openrouter";

test("tool requests do not require optional parallel tool call support", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.equal(body.tools[0].function.name, "web_search");
    assert.equal(body.tool_choice, "auto");
    assert.equal("parallel_tool_calls" in body, false);
    return Response.json({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "1",
                type: "function",
                function: { name: "web_search", arguments: '{"query":"test query"}' },
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const result = await research(
      [{ role: "user", content: "Search" }],
      new AbortController().signal,
    );
    assert.equal(result.message.tool_calls?.[0].function.name, "web_search");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
