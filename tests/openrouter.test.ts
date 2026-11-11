import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, research } from "../src/server/providers/openrouter";
import { runAgent } from "../src/server/agent";
import { Store } from "../src/server/store";
import type { AgentEvent } from "../src/lib/types";

async function withOpenRouter(fetch: typeof globalThis.fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const names = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_RESEARCH_MODEL"];
  const previous = names.map((name) => process.env[name]);
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/answer";
  process.env.OPENROUTER_RESEARCH_MODEL = "test/research";
  globalThis.fetch = fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

const messages = [{ role: "user" as const, content: "Search" }];
const signal = () => new AbortController().signal;
async function collectAnswer(abortSignal = signal()) {
  const output = [];
  for await (const part of answer(messages, abortSignal)) output.push(part);
  return output;
}

test("SDK tool requests use the configured model, schema, usage, and routing without requiring parallel tools", async () => {
  await withOpenRouter(
    async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-key");
      assert.equal(headers.get("X-OpenRouter-Title"), "Minimi");
      assert.ok(init?.signal instanceof AbortSignal);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "test/research");
      assert.equal(body.max_tokens, 3000);
      assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
      assert.deepEqual(body.provider, { require_parameters: true });
      assert.equal(body.tools[0].function.name, "web_search");
      assert.equal(body.tools[0].function.parameters.properties.query.maxLength, 500);
      assert.deepEqual(body.tools[0].function.parameters.required, ["query"]);
      assert.equal(body.tool_choice, "auto");
      assert.equal("parallel_tool_calls" in body, false);
      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
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
        usage: { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 },
      });
    },
    async () => {
      const result = await research(messages, signal());
      assert.equal(result.toolCalls[0].toolName, "web_search");
      assert.deepEqual(result.toolCalls[0].input, { query: "test query" });
      assert.equal(result.usage?.inputTokens, 5);
      assert.equal(result.usage?.outputTokens, 9);
    },
  );
});

test("SDK messages round-trip opaque reasoning and tool results only to the research model", async () => {
  let requests = 0;
  const reasoning = [{ type: "reasoning.encrypted", data: "opaque-private-state", id: "r1" }];
  await withOpenRouter(
    async (_url, init) => {
      if (++requests === 1)
        return Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                reasoning_details: reasoning,
                tool_calls: [
                  {
                    id: "search-1",
                    type: "function",
                    function: { name: "web_search", arguments: '{"query":"current pricing"}' },
                  },
                ],
              },
            },
          ],
        });
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.messages[1].reasoning_details, reasoning);
      assert.equal(body.messages[1].tool_calls[0].id, "search-1");
      assert.equal(body.messages[2].role, "tool");
      assert.equal(body.messages[2].tool_call_id, "search-1");
      assert.deepEqual(JSON.parse(body.messages[2].content), { results: [] });
      return Response.json({
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Ready" } }],
      });
    },
    async () => {
      const first = await research(messages, signal());
      const next = await research(
        [
          ...messages,
          ...first.messages,
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "search-1",
                toolName: "web_search",
                output: { type: "json", value: { results: [] } },
              },
            ],
          },
        ],
        signal(),
      );
      assert.equal(next.toolCalls.length, 0);
    },
  );
  assert.equal(requests, 2);
});

test("SDK streaming handles fragmented SSE, Unicode, and usage without publishing reasoning", async () => {
  await withOpenRouter(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "test/answer");
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 6000);
      assert.equal("tools" in body, false);
      return streamed(
        [
          ": heartbeat\n\n",
          'data: {"choices":[{"delta":{"reasoning":"SECRET THOUGHT"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hello नमस्ते"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":9,"total_tokens":14}}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
      );
    },
    async () => {
      const output = await collectAnswer();
      assert.equal(output.map((part) => part.text || "").join(""), "Hello नमस्ते");
      assert.equal(output.at(-1)?.usage?.inputTokens, 5);
      assert.equal(output.at(-1)?.usage?.outputTokens, 9);
      assert.equal(JSON.stringify(output).includes("SECRET"), false);
    },
  );
});

test("dropped, malformed, truncated, and provider-error streams cannot complete an answer", async (t) => {
  for (const [stream, message] of [
    ['data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n', /before the answer finished/],
    ['data: {"error":{"message":"provider secret","code":500}}\n\n', /connection failed/],
    ["data: not-json\n\n", /connection failed/],
    [
      'data: {"choices":[{"delta":{"content":"Partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      /response limit/,
    ],
    [
      'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n',
      /before the answer finished/,
    ],
  ] as const) {
    await t.test(String(message), async () => {
      await withOpenRouter(
        async () => streamed(stream),
        async () => {
          await assert.rejects(collectAnswer(), (error) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, message);
            assert.equal(error.message.includes("provider secret"), false);
            return true;
          });
        },
      );
    });
  }
});

test("SDK HTTP failures remain actionable, private, and are not automatically retried", async (t) => {
  for (const [status, message] of [
    [401, /API key/],
    [402, /credits/],
    [404, /available provider/],
    [429, /busy/],
    [503, /failed/],
  ] as const) {
    await t.test(String(status), async () => {
      let requests = 0;
      await withOpenRouter(
        async () => {
          requests++;
          return Response.json({ error: { message: "provider secret", code: status } }, { status });
        },
        async () => {
          await assert.rejects(research(messages, signal()), message);
          await assert.rejects(collectAnswer(), message);
        },
      );
      assert.equal(requests, 2);
    });
  }
});

test("missing configuration and pre-aborted signals do not make model requests", async () => {
  await withOpenRouter(
    async () => {
      throw new Error("Unexpected network request");
    },
    async () => {
      process.env.OPENROUTER_API_KEY = "";
      await assert.rejects(research(messages, signal()), /Add OPENROUTER_API_KEY/);
      await assert.rejects(collectAnswer(), /Add OPENROUTER_API_KEY/);
      process.env.OPENROUTER_API_KEY = "test-key";
      const abort = new AbortController();
      abort.abort();
      await assert.rejects(research(messages, abort.signal), { name: "AbortError" });
      await assert.rejects(collectAnswer(abort.signal), { name: "AbortError" });
    },
  );
});

test("SDK research recovers from invalid calls, returns evidence, and streams a persisted answer", async () => {
  let requests = 0;
  let searches = 0;
  const db = new Store(":memory:");
  const conversationId = db.create("alice");
  const turn = db.begin("alice", conversationId, "Check current pricing");
  const events: AgentEvent[] = [];
  try {
    await withOpenRouter(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests++;
        assert.equal(body.messages[0].role, "system");
        assert.match(body.messages[0].content[0].text, /Minimi/);
        if (body.stream) {
          assert.equal(requests, 4);
          assert.equal(JSON.stringify(body.messages).includes("PRIVATE RESEARCH"), false);
          assert.equal(JSON.stringify(body.messages).includes("https://example.com/pricing"), true);
          return streamed(
            [
              'data: {"choices":[{"delta":{"content":"It costs $19. [S1]"}}]}\n\n',
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":9,"total_tokens":14}}\n\n',
              "data: [DONE]\n\n",
            ].join(""),
          );
        }
        if (requests === 2) {
          const results = body.messages.filter(
            (message: { role: string }) => message.role === "tool",
          );
          assert.equal(results.length, 1);
          assert.match(results[0].content, /Invalid search arguments/);
        }
        if (requests === 3) {
          const results = body.messages.filter(
            (message: { role: string }) => message.role === "tool",
          );
          assert.equal(results.length, 2);
          assert.equal(JSON.parse(results[1].content).results[0].id, "S1");
          return Response.json({
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Ready" } }],
          });
        }
        return Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: "PRIVATE RESEARCH",
                tool_calls: [
                  {
                    id: String(requests),
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: requests === 1 ? '{"query":""}' : '{"query":"current pricing"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        });
      },
      async () => {
        await runAgent(
          {
            owner: "alice",
            turn,
            timezone: "UTC",
            db,
            signal: signal(),
            emit: (event) => events.push(event),
          },
          {
            research,
            answer,
            search: async (input) => {
              searches++;
              return [
                {
                  url: "https://example.com/pricing",
                  title: "Pricing",
                  content: "Plan is $19",
                  publishedAt: null,
                  retrievedAt: new Date().toISOString(),
                  query: input.query,
                },
              ];
            },
          },
        );
      },
    );
    const saved = db.turns("alice", conversationId)[0];
    assert.equal(saved.status, "complete", JSON.stringify(events));
    assert.equal(saved.assistantText, "It costs $19. [S1]");
    assert.equal(searches, 1);
    assert.equal(saved.metrics?.modelCalls, 4);
    assert.equal(saved.metrics?.inputTokens, 9);
    assert.equal(saved.metrics?.outputTokens, 15);
    assert.equal(JSON.stringify(events).includes("PRIVATE RESEARCH"), false);
    assert.ok(events.some((event) => event.type === "speech" && event.text.includes("$19")));
  } finally {
    db.db.close();
  }
});

test("cancelling an SDK answer aborts the upstream request and preserves only partial text", async () => {
  const abort = new AbortController();
  let upstreamSignal: AbortSignal | null | undefined;
  await withOpenRouter(
    async (_url, init) => {
      upstreamSignal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'),
          );
          upstreamSignal?.addEventListener("abort", () => controller.error(abort.signal.reason), {
            once: true,
          });
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    },
    async () => {
      const output: string[] = [];
      await assert.rejects(
        async () => {
          for await (const part of answer(messages, abort.signal)) {
            if (part.text) {
              output.push(part.text);
              abort.abort();
            }
          }
        },
        { name: "AbortError" },
      );
      assert.deepEqual(output, ["Partial"]);
      assert.equal(upstreamSignal?.aborted, true);
    },
  );
});
