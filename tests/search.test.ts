import { test } from "node:test";
import assert from "node:assert/strict";
import { webSearch } from "../src/server/providers/search";

async function withExa(fetch: typeof globalThis.fetch, run: () => Promise<void>) {
  const previousKey = process.env.EXA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.EXA_API_KEY = "test-exa-key";
  globalThis.fetch = fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previousKey;
  }
}

test("Exa receives authentication, live highlights, domain filters, and whole-day publication bounds", async () => {
  await withExa(
    async (url, init) => {
      assert.equal(url, "https://api.exa.ai/search");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("x-api-key"), "test-exa-key");
      assert.ok(init?.signal instanceof AbortSignal);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        query: "Neon pricing changes",
        type: "auto",
        numResults: 5,
        contents: { highlights: { maxCharacters: 6500 }, maxAgeHours: 0, livecrawlTimeout: 10_000 },
        startPublishedDate: "2024-02-01T00:00:00.000Z",
        endPublishedDate: "2024-03-01T00:00:00.000Z",
        includeDomains: ["neon.tech"],
      });
      return Response.json({
        results: [
          {
            url: "https://neon.tech/pricing",
            title: "Pricing",
            highlights: ["Relevant price passage"],
            publishedDate: "2024-02-29T12:00:00Z",
          },
        ],
      });
    },
    async () => {
      const before = Date.now();
      const result = await webSearch(
        {
          query: "Neon pricing changes",
          start_date: "2024-02-01",
          end_date: "2024-02-29",
          domains: ["neon.tech"],
        },
        new AbortController().signal,
      );
      assert.equal(result[0].content, "Relevant price passage");
      assert.equal(result[0].publishedAt, "2024-02-29T12:00:00Z");
      assert.ok(Date.parse(result[0].retrievedAt) >= before);
      assert.equal(result[0].query, "Neon pricing changes");
    },
  );
});

test("current pricing searches omit publication filters and normalize missing metadata safely", async () => {
  await withExa(
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal("startPublishedDate" in body, false);
      assert.equal("endPublishedDate" in body, false);
      assert.equal("includeDomains" in body, false);
      return Response.json({
        results: [
          {
            url: "https://example.com/pricing",
            title: null,
            highlights: ["Focused evidence"],
            text: "Page body",
            publishedDate: null,
          },
          { url: "https://example.com/text-only", text: "Fallback page text" },
          { url: "javascript:alert(1)", highlights: ["Unsafe link"] },
          { url: "https://example.com/no-evidence", title: "Title only" },
        ],
      });
    },
    async () => {
      const result = await webSearch({ query: "current pricing" }, new AbortController().signal);
      assert.equal(result.length, 2);
      assert.equal(result[0].title, "example.com");
      assert.equal(result[0].publishedAt, null);
      assert.equal(result[0].content, "Focused evidence\n\nPage excerpt:\nPage body");
      assert.equal(result[1].content, "Fallback page text");
    },
  );
});

test("missing Exa configuration fails before making any network request", async () => {
  await withExa(
    async () => {
      throw new Error("Network must not be called");
    },
    async () => {
      process.env.EXA_API_KEY = "";
      await assert.rejects(
        webSearch({ query: "pricing" }, new AbortController().signal),
        /Add EXA_API_KEY/,
      );
    },
  );
});

test("Exa failures report actionable errors without exposing provider bodies", async (t) => {
  for (const [status, message] of [
    [401, "EXA_API_KEY"],
    [403, "permissions"],
    [402, "credits"],
    [429, "usage limit"],
    [503, "temporarily unavailable"],
  ] as const) {
    await t.test(String(status), async () => {
      await withExa(
        async () => new Response("Provider-private diagnostics", { status }),
        async () => {
          await assert.rejects(
            webSearch({ query: "pricing" }, new AbortController().signal),
            (error) => {
              assert.ok(error instanceof Error);
              assert.ok(error.message.includes(message));
              assert.equal(error.message.includes("Provider-private"), false);
              return true;
            },
          );
        },
      );
    });
  }
});

test("unexpected Exa response shapes cannot become fabricated source evidence", async () => {
  await withExa(
    async () => Response.json({ results: "invalid" }),
    async () => {
      await assert.rejects(
        webSearch({ query: "pricing" }, new AbortController().signal),
        /unexpected search response/,
      );
    },
  );
});
