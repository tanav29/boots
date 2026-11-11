"use client";

import { isValidElement, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Check, ChevronDown, Copy, Globe2, History, Volume2 } from "lucide-react";
import type { Turn } from "@/lib/types";
import { Brand } from "./brand";
import { CodeBlock } from "./code-block";

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
    <article className="min-w-0 space-y-4 py-6">
      <div className="mb-7 flex justify-end">
        <p className="max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap wrap-break-word sm:max-w-[80%]">
          {turn.userText}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
        <Brand small />
        <span>minimi</span>
        <time className="ml-auto text-[11px] font-normal text-zinc-500" dateTime={turn.createdAt}>
          {new Date(turn.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </time>
      </div>
      {turn.searches.length > 0 && (
        <details
          className="text-xs text-zinc-500"
          open={active && !turn.assistantText ? true : undefined}
        >
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded py-1 hover:text-zinc-800 [&::-webkit-details-marker]:hidden">
            <Globe2 size={14} />
            <span>
              {active && !turn.assistantText
                ? "Searching the web"
                : `Searched ${turn.searches.length} ${turn.searches.length === 1 ? "query" : "queries"}`}
            </span>
            <ChevronDown size={13} />
          </summary>
          <div className="mt-2 space-y-2 border-l border-zinc-200 pl-3">
            {turn.searches.map((search) => (
              <div className="flex items-start gap-2" key={search.id}>
                <span
                  className={`mt-1.5 size-1 shrink-0 rounded-full ${search.status === "error" ? "bg-amber-500" : search.status === "searching" ? "bg-violet-500 motion-safe:animate-pulse" : "bg-zinc-400"}`}
                />
                <span className="min-w-0 flex-1 wrap-break-word">{search.query}</span>
                <small className="shrink-0 text-[11px] text-zinc-500">
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
        <div className="space-y-4 text-[15px] leading-7 wrap-break-word text-zinc-700 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-500 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:text-zinc-900 [&_h2]:text-zinc-900 [&_h3]:text-zinc-900 [&_hr]:border-zinc-200 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold [&_strong]:text-zinc-800">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    /^\d+$/.test(String(children))
                      ? "mx-0.5 inline-flex min-w-4 items-center justify-center rounded bg-violet-50 px-1 align-super text-[10px] leading-4 text-violet-600 hover:bg-violet-100"
                      : "text-violet-600 underline decoration-violet-200 underline-offset-3 hover:decoration-violet-600"
                  }
                >
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="my-4 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm [&_th]:border-b [&_th]:border-zinc-200 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-zinc-800 [&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2">
                    {children}
                  </table>
                </div>
              ),
              code: ({ className, children }) => (
                <code
                  className={className || "rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em]"}
                >
                  {children}
                </code>
              ),
              pre: ({ children }) => {
                if (!isValidElement<{ className?: string; children?: ReactNode }>(children))
                  return (
                    <pre className="overflow-x-auto rounded-xl bg-zinc-50 p-4 text-sm">
                      {children}
                    </pre>
                  );
                return (
                  <CodeBlock
                    language={children.props.className?.replace("language-", "")}
                    code={String(children.props.children ?? "").replace(/\n$/, "")}
                  />
                );
              },
            }}
          >
            {cited}
          </Markdown>
          {active && (
            <span
              className="inline-block h-4 w-1 rounded-full bg-zinc-400 motion-safe:animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
      ) : active ? (
        <div className="flex items-center gap-2 py-2 text-sm text-zinc-500" role="status">
          <span
            className="size-1.5 rounded-full bg-violet-500 motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {status}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          {turn.status === "stopped"
            ? "Answer stopped. Send a message to continue."
            : "No answer was saved. Please try again."}
        </p>
      )}
      {!active && turn.assistantText && (
        <>
          {turn.sources.length > 0 && (
            <details className="text-xs text-zinc-500">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded py-1 hover:text-zinc-800 [&::-webkit-details-marker]:hidden">
                <Globe2 size={13} />
                {turn.sources.length} sources
                <ChevronDown size={13} />
              </summary>
              <div className="mt-2 space-y-3 border-l border-zinc-200 pl-3">
                {turn.sources.map((source) => (
                  <a
                    className="block rounded py-1 hover:text-zinc-900"
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    key={source.id}
                  >
                    <span className="flex items-center gap-2 text-[11px] text-zinc-500">
                      {source.id.slice(1)}
                      <span>{domain(source.url)}</span>
                      <ArrowUpRight size={12} />
                    </span>
                    <strong className="mt-0.5 block font-medium text-zinc-700">
                      {source.title}
                    </strong>
                    <small className="mt-0.5 block text-[11px] text-zinc-500">
                      Checked {new Date(source.retrievedAt).toLocaleDateString()}
                      {source.publishedAt ? ` · Published ${source.publishedAt}` : ""}
                    </small>
                  </a>
                ))}
              </div>
            </details>
          )}
          <div className="flex items-center gap-1 text-[11px] text-zinc-500 [&>button]:grid [&>button]:size-8 [&>button]:place-items-center [&>button]:rounded-lg [&>button:hover]:bg-zinc-100 [&>button:hover]:text-zinc-700 [&>span]:ml-2">
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
            {turn.metrics && <span>{(turn.metrics.durationMs / 1000).toFixed(1)}s</span>}
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
    <div className="flex items-start gap-2 py-2 text-xs leading-5 text-zinc-500">
      <History className="mt-1 shrink-0" size={13} />
      <span>
        {count
          ? `${count} saved ${count === 1 ? "exchange" : "exchanges"} in context`
          : "No matching saved conversation"}
        {anchors.length > 0 && ` · ${anchors.map((a) => `${a.text}: ${a.date}`).join(", ")}`}
      </span>
    </div>
  );
}
