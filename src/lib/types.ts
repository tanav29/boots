export type Source = {
  id: string;
  url: string;
  title: string;
  content: string;
  publishedAt: string | null;
  retrievedAt: string;
  query: string;
};

export type SearchActivity = {
  id: string;
  query: string;
  status: "searching" | "complete" | "error";
  count?: number;
};

export type Turn = {
  id: string;
  conversationId: string;
  userText: string;
  assistantText: string;
  createdAt: string;
  status: "running" | "complete" | "error" | "stopped";
  sources: Source[];
  searches: SearchActivity[];
  metrics: RunMetrics | null;
};

export type RunMetrics = {
  durationMs: number;
  firstTokenMs: number | null;
  searchCount: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
};

export type Conversation = { id: string; title: string; updatedAt: string; turnCount: number };
export type MemoryMatch = { turn: Turn; reason: "date" | "keyword" | "recent" };
export type DateAnchor = { text: string; date: string; start: string; end: string };

// This allowlist is also the voice boundary: only speech events enter TTS.
export type AgentEvent =
  | { type: "start"; conversationId: string; turnId: string; createdAt: string }
  | {
      type: "memory";
      matches: { id: string; date: string; question: string; reason: string }[];
      anchors: { text: string; date: string }[];
    }
  | { type: "status"; text: string }
  | { type: "search"; activity: SearchActivity }
  | { type: "sources"; sources: Source[] }
  | { type: "text"; delta: string }
  | { type: "speech"; text: string }
  | { type: "done"; status: Turn["status"]; metrics: RunMetrics }
  | { type: "error"; message: string };
