"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Check, ChevronDown, Copy, Globe2, History, Volume2 } from "lucide-react";
import type { Turn } from "@/lib/types";
import { Brand } from "./brand";

export function Answer({
  turn,
  active,
  status,
  onSpeak,
  voiceAvailable,
}: {
  turn: Turn;
  active: boolean;
  status: string;
  onSpeak: (text: string) => void;
  voiceAvailable: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const sourceById = new Map(turn.sources.map((s) => [s.id, s]));
  const cited = turn.assistantText.replace(/\[S(\d+)\]/g, (_all, n: string) => {
    const source = sourceById.get(`S${n}`);
    return source ? `[${n}](${source.url})` : "[unverified source]";
  });
  const domain = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "Source";
    }
  };
  return (
    <article className="turn">
      <div className="user-message">
        <span>{turn.userText}</span>
      </div>
      <div className="answer-heading">
        <Brand small />
        <span>minimi</span>
        <time dateTime={turn.createdAt}>
          {new Date(turn.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </time>
      </div>
      {turn.searches.length > 0 && (
        <details
          className="research-details"
          open={active && !turn.assistantText ? true : undefined}
        >
          <summary>
            <Globe2 size={14} />
            <span>
              {active && !turn.assistantText
                ? "Searching the web"
                : `Searched ${turn.searches.length} ${turn.searches.length === 1 ? "query" : "queries"}`}
            </span>
            <ChevronDown size={13} />
          </summary>
          <div className="search-list">
            {turn.searches.map((search) => (
              <div key={search.id}>
                <span className={`search-dot ${search.status}`} />
                <span>{search.query}</span>
                <small>
                  {search.status === "complete"
                    ? `${search.count} sources`
                    : search.status === "error"
                      ? "Unavailable"
                      : "Searching…"}
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
      {turn.assistantText ? (
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={/^\d+$/.test(String(children)) ? "citation" : undefined}
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="table-scroll">
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {cited}
          </Markdown>
          {active && <span className="text-cursor" />}
        </div>
      ) : active ? (
        <div className="answer-pending" role="status">
          <span className="thinking-dot" />
          {status}
        </div>
      ) : (
        <p className="muted">
          {turn.status === "stopped"
            ? "Answer stopped. Send a message to continue."
            : "No answer was saved. Please try again."}
        </p>
      )}
      {!active && turn.assistantText && (
        <>
          {turn.sources.length > 0 && (
            <details className="source-details">
              <summary>
                <Globe2 size={13} />
                {turn.sources.length} sources
                <ChevronDown size={13} />
              </summary>
              <div className="source-grid">
                {turn.sources.map((source) => (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" key={source.id}>
                    <span className="source-domain">
                      {source.id.slice(1)}
                      <span>{domain(source.url)}</span>
                      <ArrowUpRight size={12} />
                    </span>
                    <strong>{source.title}</strong>
                    <small>
                      Checked {new Date(source.retrievedAt).toLocaleDateString()}
                      {source.publishedAt ? ` · Published ${source.publishedAt}` : ""}
                    </small>
                  </a>
                ))}
              </div>
            </details>
          )}
          <div className="answer-actions">
            <button
              aria-label="Copy answer"
              title="Copy answer"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(turn.assistantText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            {voiceAvailable && (
              <button
                aria-label="Read answer aloud"
                title="Read answer aloud"
                onClick={() => onSpeak(turn.assistantText)}
              >
                <Volume2 size={16} />
              </button>
            )}
            {turn.status === "stopped" && <span>Stopped</span>}
            {turn.status === "error" && <span>Incomplete answer</span>}
            {turn.metrics && (
              <span className="answer-duration">
                {(turn.metrics.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </>
      )}
    </article>
  );
}

export function MemoryIndicator({
  count,
  anchors,
}: {
  count: number;
  anchors: { text: string; date: string }[];
}) {
  if (!count && !anchors.length) return null;
  return (
    <div className="memory-indicator">
      <History size={13} />
      <span>
        {count
          ? `${count} saved ${count === 1 ? "exchange" : "exchanges"} in context`
          : "No matching saved conversation"}
        {anchors.length > 0 && ` · ${anchors.map((a) => `${a.text}: ${a.date}`).join(", ")}`}
      </span>
    </div>
  );
}
