import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Conversation,
  DateAnchor,
  MemoryMatch,
  RunMetrics,
  SearchActivity,
  Source,
  Turn,
} from "@/lib/types";
import { AppError } from "./config";

type TurnRow = {
  id: string;
  conversation_id: string;
  user_text: string;
  assistant_text: string;
  created_at: string;
  status: Turn["status"];
  sources: string;
  searches: string;
  metrics: string | null;
};

function toTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userText: row.user_text,
    assistantText: row.assistant_text,
    createdAt: row.created_at,
    status: row.status,
    sources: JSON.parse(row.sources),
    searches: JSON.parse(row.searches),
    metrics: row.metrics ? JSON.parse(row.metrics) : null,
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(owner, updated_at);
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_text TEXT NOT NULL, assistant_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running', sources TEXT NOT NULL DEFAULT '[]',
        searches TEXT NOT NULL DEFAULT '[]', metrics TEXT
      );
      CREATE INDEX IF NOT EXISTS turn_dates ON turns(created_at, conversation_id);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_turn ON turns(conversation_id) WHERE status = 'running';
      CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts USING fts5(user_text, assistant_text, content='turns', content_rowid='rowid', tokenize='porter unicode61');
      CREATE TRIGGER IF NOT EXISTS turn_insert AFTER INSERT ON turns BEGIN
        INSERT INTO turn_fts(rowid, user_text, assistant_text) VALUES (new.rowid, new.user_text, new.assistant_text);
      END;
      CREATE TRIGGER IF NOT EXISTS turn_delete AFTER DELETE ON turns BEGIN
        INSERT INTO turn_fts(turn_fts, rowid, user_text, assistant_text) VALUES ('delete', old.rowid, old.user_text, old.assistant_text);
      END;
      CREATE TRIGGER IF NOT EXISTS turn_update AFTER UPDATE OF assistant_text ON turns BEGIN
        INSERT INTO turn_fts(turn_fts, rowid, user_text, assistant_text) VALUES ('delete', old.rowid, old.user_text, old.assistant_text);
        INSERT INTO turn_fts(rowid, user_text, assistant_text) VALUES (new.rowid, new.user_text, new.assistant_text);
      END;
    `);
  }

  list(owner: string): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.updated_at AS updatedAt, COUNT(t.id) AS turnCount
      FROM conversations c LEFT JOIN turns t ON c.id=t.conversation_id WHERE c.owner=?
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100`,
      )
      .all(owner);
    return rows as Conversation[];
  }

  create(owner: string, title = "New conversation", now = new Date().toISOString()): string {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO conversations VALUES (?, ?, ?, ?)")
      .run(id, owner, title.slice(0, 80), now);
    return id;
  }

  assertOwner(owner: string, conversationId: string) {
    if (
      !this.db
        .prepare("SELECT id FROM conversations WHERE id=? AND owner=?")
        .get(conversationId, owner)
    ) {
      throw new AppError("Conversation not found.", 404);
    }
  }

  turns(owner: string, conversationId: string): Turn[] {
    this.assertOwner(owner, conversationId);
    this.recoverStale();
    return (
      this.db
        .prepare("SELECT * FROM turns WHERE conversation_id=? ORDER BY created_at, rowid")
        .all(conversationId) as TurnRow[]
    ).map(toTurn);
  }

  delete(owner: string, conversationId: string) {
    this.assertOwner(owner, conversationId);
    this.recoverStale();
    if (
      this.db
        .prepare("SELECT id FROM turns WHERE conversation_id=? AND status='running'")
        .get(conversationId)
    ) {
      throw new AppError("Stop the active answer before deleting this conversation.", 409);
    }
    this.db.prepare("DELETE FROM conversations WHERE id=? AND owner=?").run(conversationId, owner);
  }

  private recoverStale() {
    this.db
      .prepare("UPDATE turns SET status='stopped' WHERE status='running' AND created_at < ?")
      .run(new Date(Date.now() - 4 * 60_000).toISOString());
  }

  begin(owner: string, conversationId: string, text: string, now = new Date().toISOString()): Turn {
    this.assertOwner(owner, conversationId);
    this.recoverStale();
    const id = randomUUID();
    try {
      this.db
        .prepare(
          "INSERT INTO turns (id, conversation_id, user_text, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, conversationId, text, now);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new AppError("This conversation already has an active answer.", 409);
      throw error;
    }
    this.db
      .prepare(
        "UPDATE conversations SET updated_at=?, title=CASE WHEN title='New conversation' THEN ? ELSE title END WHERE id=?",
      )
      .run(now, text.replace(/\s+/g, " ").slice(0, 64), conversationId);
    return {
      id,
      conversationId,
      userText: text,
      assistantText: "",
      createdAt: now,
      status: "running",
      sources: [],
      searches: [],
      metrics: null,
    };
  }

  finish(
    id: string,
    text: string,
    status: Turn["status"],
    sources: Source[],
    searches: SearchActivity[],
    metrics: RunMetrics,
  ) {
    this.db
      .prepare(
        "UPDATE turns SET assistant_text=?, status=?, sources=?, searches=?, metrics=? WHERE id=?",
      )
      .run(
        text,
        status,
        JSON.stringify(sources),
        JSON.stringify(searches),
        JSON.stringify(metrics),
        id,
      );
  }

  recall(
    owner: string,
    conversationId: string,
    query: string,
    anchors: DateAnchor[],
  ): {
    matches: MemoryMatch[];
    catalogue: { question: string; date: string }[];
    dateCounts: { date: string; count: number }[];
  } {
    this.assertOwner(owner, conversationId);
    const matches = new Map<string, MemoryMatch>();
    const add = (rows: TurnRow[], reason: MemoryMatch["reason"]) =>
      rows.forEach((row) => {
        if (!matches.has(row.id)) matches.set(row.id, { turn: toTurn(row), reason });
      });
    // Exact-day matches take precedence, including across separate conversations.
    const dateCounts = anchors.map((anchor) => {
      const rows = this.db
        .prepare(
          `SELECT t.* FROM turns t JOIN conversations c ON c.id=t.conversation_id
        WHERE c.owner=? AND t.status!='running' AND t.created_at>=? AND t.created_at<? ORDER BY t.created_at LIMIT 20`,
        )
        .all(owner, anchor.start, anchor.end) as TurnRow[];
      add(rows, "date");
      const count = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM turns t JOIN conversations c ON c.id=t.conversation_id
        WHERE c.owner=? AND t.status!='running' AND t.created_at>=? AND t.created_at<?`,
        )
        .get(owner, anchor.start, anchor.end) as { n: number };
      return { date: anchor.date, count: count.n };
    });
    const stop = new Set(
      "what when where which who how did does do i you we me my your our on the a an and or of to for from in is it its any has have had last today yesterday since still about asked ask them then monday tuesday wednesday thursday friday saturday sunday changed change correct pricing".split(
        " ",
      ),
    );
    const tokens = [
      ...new Set(
        (query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !stop.has(w)),
      ),
    ].slice(0, 18);
    if (tokens.length) {
      // Quoted tokens prevent FTS syntax injection. BM25 ranks questions above answers.
      const expression = tokens.map((t) => `"${t}"`).join(" OR ");
      add(
        this.db
          .prepare(
            `SELECT t.* FROM turn_fts JOIN turns t ON t.rowid=turn_fts.rowid
        JOIN conversations c ON c.id=t.conversation_id WHERE turn_fts MATCH ? AND c.owner=? AND t.status!='running'
        ORDER BY bm25(turn_fts, 3.0, 1.0) LIMIT 8`,
          )
          .all(expression, owner) as TurnRow[],
        "keyword",
      );
    }
    add(
      this.db
        .prepare(
          `SELECT t.* FROM turns t JOIN conversations c ON c.id=t.conversation_id
      WHERE c.owner=? AND t.status!='running' ORDER BY t.created_at DESC, t.rowid DESC LIMIT 6`,
        )
        .all(owner) as TurnRow[],
      "recent",
    );
    const catalogue = this.db
      .prepare(
        `SELECT t.user_text AS question, t.created_at AS date FROM turns t
      JOIN conversations c ON c.id=t.conversation_id WHERE c.owner=? AND t.status!='running'
      ORDER BY t.created_at DESC, t.rowid DESC LIMIT 80`,
      )
      .all(owner) as { question: string; date: string }[];
    return { matches: [...matches.values()], catalogue, dateCounts };
  }
}

const globalStore = globalThis as unknown as { minimiStore?: Store };
export function store(): Store {
  return (globalStore.minimiStore ??= new Store(
    process.env.DATABASE_PATH || "./data/minimi.sqlite",
  ));
}
