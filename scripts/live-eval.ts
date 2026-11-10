import { mkdir, writeFile } from "node:fs/promises";
import { Store } from "../src/server/store";
import { runAgent } from "../src/server/agent";
import { settings } from "../src/server/config";
import { resolveDates } from "../src/server/time";
import type { AgentEvent, RunMetrics } from "../src/lib/types";

async function main() {
  if (!settings().openrouterKey || !settings().searchKey) {
    throw new Error(
      "Set OPENROUTER_API_KEY and EXA_API_KEY in .env before running paid live evaluations.",
    );
  }
  const db = new Store(":memory:");
  const owner = "isolated-live-eval";
  const now = new Date();
  const anchor = resolveDates("last Tuesday", "UTC", now)[0];
  const history = db.create(owner, "Historical Postgres advice");
  const baseline = db.begin(
    owner,
    history,
    "Compare Neon and Supabase Postgres hosting for our small app. We need a paid plan.",
    anchor.start,
  );
  const emptyMetrics: RunMetrics = {
    durationMs: 0,
    firstTokenMs: 0,
    searchCount: 0,
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  db.finish(
    baseline.id,
    "We shortlisted Neon and Supabase. I did not verify current prices, so no reliable price baseline was recorded.",
    "complete",
    [],
    [],
    emptyMetrics,
  );
  const cases = [
    {
      name: "Exact-day recall",
      question: `What did I ask you on ${anchor.date}?`,
      searchesExpected: false,
    },
    {
      name: "Recheck an uncertain historical baseline",
      question: "Last Tuesday I asked about Postgres hosting. Has any pricing changed since then?",
      searchesExpected: true,
    },
    {
      name: "Missing historical conversation",
      question: "On 1 January 2020 we shortlisted 5 CRM tools. Has any of them changed pricing?",
      searchesExpected: false,
    },
  ];
  const report = [];
  for (const item of cases) {
    console.log(`Running: ${item.name}`);
    const conversation = db.create(owner, item.name);
    const turn = db.begin(owner, conversation, item.question, now.toISOString());
    const events: AgentEvent[] = [];
    await runAgent({
      owner,
      turn,
      timezone: "UTC",
      db,
      signal: AbortSignal.timeout(170000),
      emit: (event) => events.push(event),
    });
    const result = db.turns(owner, conversation)[0];
    report.push({
      ...item,
      result,
      errors: events.filter((e) => e.type === "error"),
      checks: {
        completed: result.status === "complete",
        searchBehaviorMatches: Boolean(result.searches.length) === item.searchesExpected,
        noInventedCitations: [...result.assistantText.matchAll(/\[S(\d+)\]/g)].every((m) =>
          result.sources.some((s) => s.id === `S${m[1]}`),
        ),
      },
    });
    console.log(
      `  ${result.status}; ${result.searches.length} searches; ${result.metrics?.durationMs}ms`,
    );
  }
  await mkdir("test-results", { recursive: true });
  const path = `test-results/live-eval-${Date.now()}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        model: settings().model,
        baselineDate: anchor.date,
        report,
      },
      null,
      2,
    ),
  );
  console.log(`Saved ${path}. Review factual accuracy and citation support manually.`);
  db.db.close();
  if (report.some((r) => !Object.values(r.checks).every(Boolean))) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
