import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/store";
import { resolveDates } from "../src/server/time";
import type { RunMetrics } from "../src/lib/types";

const metrics: RunMetrics = {
  durationMs: 1,
  firstTokenMs: 1,
  searchCount: 0,
  modelCalls: 1,
  inputTokens: 10,
  outputTokens: 10,
};
const now = new Date("2026-11-10T15:00:00.000Z");
function fixture() {
  const db = new Store(":memory:");
  const old = db.create("alice", "Postgres shortlist");
  const turn = db.begin(
    "alice",
    old,
    "Compare Neon and Supabase Postgres hosting",
    "2026-11-02T18:30:00.000Z",
  );
  db.finish(
    turn.id,
    "We shortlisted Neon and Supabase for a 20-person team.",
    "complete",
    [
      {
        id: "S1",
        title: "Neon pricing",
        url: "https://neon.tech/pricing",
        content: "A saved historical passage",
        publishedAt: null,
        retrievedAt: "2026-11-03T00:00:00.000Z",
        query: "Neon pricing",
      },
    ],
    [],
    metrics,
  );
  const current = db.create("alice");
  return { db, old, current, turn };
}

test("retrieves exact local-day baseline across conversations, including midnight", () => {
  const { db, current, turn } = fixture();
  const recalled = db.recall(
    "alice",
    current,
    "What did I ask last Tuesday?",
    resolveDates("last Tuesday", "Asia/Kolkata", now),
  );
  assert.equal(recalled.matches[0].turn.id, turn.id);
  assert.equal(recalled.matches[0].reason, "date");
  assert.equal(recalled.dateCounts[0].count, 1);
  assert.equal(recalled.matches[0].turn.sources[0].content, "A saved historical passage");
  db.db.close();
});
test("full-text retrieval finds a baseline even after it falls out of recent history", () => {
  const { db, current, turn } = fixture();
  for (let i = 0; i < 12; i++) {
    const t = db.begin(
      "alice",
      current,
      `Unrelated cooking question ${i}`,
      `2026-11-09T10:${String(i).padStart(2, "0")}:00.000Z`,
    );
    db.finish(t.id, "Try more salt", "complete", [], [], metrics);
  }
  const found = db.recall("alice", current, "Has Postgres hosting changed?", []);
  assert.equal(found.matches.find((m) => m.turn.id === turn.id)?.reason, "keyword");
  db.db.close();
});
test("records and search results are scoped to the browser owner", () => {
  const { db, current, old } = fixture();
  const bob = db.create("bob");
  assert.equal(db.recall("bob", bob, "Postgres", []).matches.length, 0);
  assert.throws(() => db.turns("bob", old), /not found/);
  assert.throws(() => db.delete("bob", current), /not found/);
  assert.equal(db.list("bob").length, 1);
  db.db.close();
});
test("deleting a conversation removes both raw history and its FTS memory", () => {
  const { db, old, current } = fixture();
  db.delete("alice", old);
  assert.equal(db.recall("alice", current, "Postgres", []).matches.length, 0);
  db.db.close();
});
test("concurrent answers conflict, while stopped turns release the lease", () => {
  const { db, current } = fixture();
  const t = db.begin("alice", current, "Question");
  assert.throws(() => db.begin("alice", current, "Another question"), /active answer/);
  assert.throws(() => db.delete("alice", current), /Stop the active answer/);
  db.finish(t.id, "Partial", "stopped", [], [], metrics);
  assert.ok(db.begin("alice", current, "Continue"));
  db.db.close();
});
test("FTS metacharacters cannot break retrieval or escape owner scope", () => {
  const { db, current } = fixture();
  assert.doesNotThrow(() => db.recall("alice", current, '" OR * NEAR postgres ): {column}', []));
  db.db.close();
});
