import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/store";
import { runAgent } from "../src/server/agent";
import { AppError } from "../src/server/config";
import type { AgentEvent } from "../src/lib/types";
import type { ModelMessage } from "../src/server/providers/openrouter";

test("research is private; final answer streams and speaks; one failed search preserves other evidence", async () => {
  const db = new Store(":memory:");
  const id = db.create("alice");
  const turn = db.begin("alice", id, "Check Neon and Supabase pricing");
  const events: AgentEvent[] = [];
  let researchCalls = 0;
  let finalMessages: ModelMessage[] = [];
  let concurrent = 0;
  let peak = 0;
  await runAgent(
    {
      owner: "alice",
      turn,
      db,
      timezone: "UTC",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    },
    {
      research: async () => ({
        message:
          ++researchCalls === 1
            ? {
                role: "assistant",
                content: "PRIVATE RESEARCH",
                tool_calls: [
                  {
                    id: "one",
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: '{"query":"Neon official pricing"}',
                    },
                  },
                  {
                    id: "two",
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: '{"query":"Supabase official pricing"}',
                    },
                  },
                ],
              }
            : { role: "assistant", content: "READY" },
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      search: async (input) => {
        peak = Math.max(peak, ++concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent--;
        if (input.query.startsWith("Supabase")) throw new AppError("Search quota reached.", 502);
        return [
          {
            url: "https://neon.tech/pricing",
            title: "Pricing",
            content: "Plan is $19",
            publishedAt: null,
            retrievedAt: new Date().toISOString(),
            query: input.query,
          },
        ];
      },
      answer: async function* (messages) {
        finalMessages = messages;
        yield { text: "Neon is $19. [S1] " };
        yield { text: "Supabase could not be checked." };
      },
    },
  );
  assert.equal(peak, 2);
  assert.equal(JSON.stringify(events).includes("PRIVATE RESEARCH"), false);
  assert.equal(JSON.stringify(events).includes("READY"), false);
  assert.ok(events.some((e) => e.type === "search" && e.activity.status === "error"));
  assert.ok(events.some((e) => e.type === "speech" && e.text.includes("Neon")));
  assert.equal(
    events.filter((e) => e.type === "speech").some((e) => e.text.includes("[S1]")),
    false,
  );
  assert.ok(JSON.stringify(finalMessages).includes("Search quota reached"));
  assert.equal(db.turns("alice", id)[0].status, "complete");
  assert.equal(db.turns("alice", id)[0].sources.length, 1);
  db.db.close();
});

test("cancellation persists a partial answer and never continues speaking", async () => {
  const db = new Store(":memory:");
  const id = db.create("a");
  const turn = db.begin("a", id, "Give me an answer");
  const abort = new AbortController();
  const events: AgentEvent[] = [];
  await runAgent(
    { owner: "a", turn, db, timezone: "UTC", signal: abort.signal, emit: (e) => events.push(e) },
    {
      research: async () => ({
        message: { role: "assistant", content: "READY" },
        usage: undefined,
      }),
      search: async () => {
        throw new Error("Unexpected search");
      },
      answer: async function* () {
        yield { text: "Partial answer" };
        abort.abort();
        yield { text: " Never read this." };
      },
    },
  );
  assert.equal(db.turns("a", id)[0].status, "stopped");
  assert.equal(db.turns("a", id)[0].assistantText, "Partial answer");
  assert.equal(
    events.some((e) => e.type === "speech" && e.text.includes("Never")),
    false,
  );
  db.db.close();
});

test("unknown tools cannot execute and the search loop is bounded", async () => {
  const db = new Store(":memory:");
  const id = db.create("a");
  const turn = db.begin("a", id, "Check something on the web");
  let calls = 0;
  let searches = 0;
  await runAgent(
    { owner: "a", turn, db, timezone: "UTC", signal: new AbortController().signal, emit: () => {} },
    {
      research: async () => ({
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: String(++calls),
              type: "function",
              function: { name: "execute_shell", arguments: "{}" },
            },
          ],
        },
        usage: undefined,
      }),
      search: async () => {
        searches++;
        return [];
      },
      answer: async function* () {
        yield { text: "I can only search the web." };
      },
    },
  );
  assert.equal(calls, 3);
  assert.equal(searches, 0);
  db.db.close();
});

test("simple greetings stream in one model call without a research round", async () => {
  const db = new Store(":memory:");
  const id = db.create("a");
  const turn = db.begin("a", id, "Hello!");
  let planningCalls = 0;
  await runAgent(
    { owner: "a", turn, db, timezone: "UTC", signal: new AbortController().signal, emit: () => {} },
    {
      research: async () => {
        planningCalls++;
        throw new Error("Should not plan greetings");
      },
      search: async () => {
        throw new Error("Should not search greetings");
      },
      answer: async function* () {
        yield { text: "Hello! What would you like to explore?" };
      },
    },
  );
  assert.equal(planningCalls, 0);
  assert.equal(db.turns("a", id)[0].metrics?.modelCalls, 1);
  assert.equal(db.turns("a", id)[0].status, "complete");
  db.db.close();
});
