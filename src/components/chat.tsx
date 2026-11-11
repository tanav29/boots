"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { createParser } from "eventsource-parser";
import {
  ArrowUp,
  AudioLines,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { AgentEvent, Conversation, Turn } from "@/lib/types";
import { SpeechPlayer } from "@/lib/speech-player";
import { speakable } from "@/lib/voice-text";
import { voiceErrorMessage } from "@/lib/voice-errors";
import { Answer, MemoryIndicator } from "./answer";
import { Brand } from "./brand";
import { VoiceActivity } from "./voice-activity";

type Config = { chat: boolean; search: boolean; voice: boolean; model: string };
const suggestions = [
  {
    title: "Explore a topic",
    text: "Compare CRM tools for a 20-person sales team. Check current pricing and explain your shortlist.",
  },
  {
    title: "Pick up a conversation",
    text: "What did I ask you last Tuesday? Is your answer still correct today?",
  },
  {
    title: "See what’s changed",
    text: "Have any of the tools we discussed changed their pricing or shipped something big since?",
  },
];

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not complete the request.");
  return data;
}

export function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Preparing your answer");
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [memory, setMemory] = useState<{
    count: number;
    anchors: { text: string; date: string }[];
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const playerRef = useRef<SpeechPlayer | null>(null);
  const busyRef = useRef(false);
  const voiceModeRef = useRef(false);
  const autoSpeakRef = useRef(false);
  const voiceStartingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<(text: string) => void>(() => {});
  const disconnectRef = useRef<() => void>(() => {});
  const loadRef = useRef(0);

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 1.2,
    onCommittedTranscript: ({ text }) => {
      if (!voiceModeRef.current || busyRef.current || !text.trim()) return;
      disconnectRef.current();
      submitRef.current(text.trim());
    },
    onError: (error) => {
      voiceModeRef.current = false;
      setVoiceMode(false);
      disconnectRef.current();
      setError(voiceErrorMessage(error));
    },
  });
  useEffect(() => {
    disconnectRef.current = scribe.disconnect;
  }, [scribe.disconnect]);

  // Share Scribe's capture track; its current API has no public input-level getter.
  const { getConnection } = scribe;
  const getInputTrack = useCallback(() => getConnection()?._mediaStreamTrack, [getConnection]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeSidebar = () => {
      if (desktop.matches) setSidebarOpen(false);
    };
    desktop.addEventListener("change", closeSidebar);
    return () => desktop.removeEventListener("change", closeSidebar);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    document.querySelector<HTMLButtonElement>("#conversation-sidebar button")?.focus();
    return () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.focus();
  }, [sidebarOpen]);

  const refresh = useCallback(async () => {
    const data = await jsonRequest<{ conversations: Conversation[]; config: Config }>(
      "/api/bootstrap",
    );
    setConversations(data.conversations);
    setConfig(data.config);
  }, []);

  useEffect(() => {
    let alive = true;
    jsonRequest<{ conversations: Conversation[]; config: Config }>("/api/bootstrap")
      .then((data) => {
        if (!alive) return;
        setConversations(data.conversations);
        setConfig(data.config);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const player = new SpeechPlayer(setSpeaking, (message) => {
      setError(message);
      autoSpeakRef.current = false;
      setAutoSpeak(false);
      voiceModeRef.current = false;
      setVoiceMode(false);
      disconnectRef.current();
    });
    playerRef.current = player;
    return () => {
      player.close();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && turns.length && stickRef.current) element.scrollTop = element.scrollHeight;
  }, [turns, status, memory]);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current || loading) return;
      if (text.length > 12000) {
        setError("Please keep your message under 12,000 characters.");
        return;
      }
      playerRef.current?.stop();
      disconnectRef.current();
      busyRef.current = true;
      setBusy(true);
      setError("");
      setDraft("");
      setMemory(null);
      setStatus("Checking conversation context");
      stickRef.current = true;
      const temporaryId = crypto.randomUUID();
      const optimistic: Turn = {
        id: temporaryId,
        conversationId: conversationId || "",
        userText: text,
        assistantText: "",
        createdAt: new Date().toISOString(),
        status: "running",
        sources: [],
        searches: [],
        metrics: null,
      };
      setTurns((previous) => [...previous, optimistic]);
      const abort = new AbortController();
      abortRef.current = abort;
      let activeId = temporaryId;
      let completed = false;
      let failed = false;
      const update = (fn: (turn: Turn) => Turn) =>
        setTurns((previous) => previous.map((t) => (t.id === activeId ? fn(t) : t)));
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            conversationId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: abort.signal,
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Could not send your message.");
        }
        if (!response.body) throw new Error("The response was empty. Please try again.");
        const parser = createParser({
          onEvent(event) {
            const data = JSON.parse(event.data) as AgentEvent;
            switch (data.type) {
              case "start": {
                const prior = activeId;
                activeId = data.turnId;
                setConversationId(data.conversationId);
                setTurns((previous) =>
                  previous.map((t) =>
                    t.id === prior
                      ? {
                          ...t,
                          id: data.turnId,
                          conversationId: data.conversationId,
                          createdAt: data.createdAt,
                        }
                      : t,
                  ),
                );
                break;
              }
              case "status":
                setStatus(data.text);
                break;
              case "memory":
                setMemory({ count: data.matches.length, anchors: data.anchors });
                break;
              case "search":
                update((t) => ({
                  ...t,
                  searches: [...t.searches.filter((s) => s.id !== data.activity.id), data.activity],
                }));
                break;
              case "sources":
                update((t) => ({ ...t, sources: data.sources }));
                break;
              case "text":
                update((t) => ({ ...t, assistantText: t.assistantText + data.delta }));
                break;
              case "speech":
                if (autoSpeakRef.current || voiceModeRef.current)
                  playerRef.current?.enqueue(data.text);
                break;
              case "error":
                failed = true;
                setError(data.message);
                break;
              case "done":
                completed = true;
                update((t) => ({ ...t, status: data.status, metrics: data.metrics }));
                break;
            }
          },
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
          }
          parser.feed(decoder.decode());
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (!completed)
          throw new Error(
            "The connection ended early. Your saved conversation will keep any partial answer.",
          );
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : "Could not complete the answer.");
          failed = true;
        }
        playerRef.current?.stop();
        update((t) => ({ ...t, status: abort.signal.aborted ? "stopped" : "error" }));
      } finally {
        if (failed) {
          voiceModeRef.current = false;
          setVoiceMode(false);
        }
        busyRef.current = false;
        setBusy(false);
        abortRef.current = null;
        void refresh().catch(() => {});
      }
    },
    [conversationId, loading, refresh],
  );
  useEffect(() => {
    submitRef.current = (text) => {
      void submit(text);
    };
  }, [submit]);

  const startListening = useCallback(async () => {
    if (voiceStartingRef.current || scribe.isConnected || busyRef.current || !voiceModeRef.current)
      return;
    voiceStartingRef.current = true;
    try {
      if (!window.isSecureContext) {
        throw new Error(
          "Voice needs a secure connection. Open this app on HTTPS or localhost, then try again.",
        );
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "This browser does not support microphone access. Try Voice in a browser that supports it, or keep typing here.",
        );
      }
      // Avoid opening a provider session when the browser already blocks capture.
      // Browsers without this Permissions API entry still use Scribe's normal prompt.
      const permission = await navigator.permissions
        ?.query({ name: "microphone" as PermissionName })
        .catch(() => null);
      if (!voiceModeRef.current) return;
      if (permission?.state === "denied") {
        throw new DOMException("Permission denied", "NotAllowedError");
      }
      await playerRef.current?.unlock();
      const { token } = await jsonRequest<{ token: string }>("/api/voice/token", {
        method: "POST",
      });
      if (!voiceModeRef.current) return;
      scribe.clearTranscripts();
      await scribe.connect({
        token,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });
      if (!voiceModeRef.current) scribe.disconnect();
    } catch (e) {
      voiceModeRef.current = false;
      setVoiceMode(false);
      setError(voiceErrorMessage(e));
    } finally {
      voiceStartingRef.current = false;
    }
  }, [scribe]);

  useEffect(() => {
    if (!voiceMode || busy || speaking || scribe.isConnected || scribe.status === "connecting")
      return;
    const timer = setTimeout(() => {
      void startListening();
    }, 400);
    return () => clearTimeout(timer);
  }, [voiceMode, busy, speaking, scribe.isConnected, scribe.status, startListening]);

  function stopVoice() {
    voiceModeRef.current = false;
    setVoiceMode(false);
    scribe.disconnect();
    playerRef.current?.stop();
  }

  async function toggleVoice() {
    if (voiceMode) {
      stopVoice();
      return;
    }
    if (!config?.voice) {
      setSettingsOpen(true);
      return;
    }
    await playerRef.current?.unlock();
    setError("");
    voiceModeRef.current = true;
    setVoiceMode(true);
    if (busyRef.current) abortRef.current?.abort();
    playerRef.current?.stop();
  }

  async function openConversation(id: string) {
    if (busyRef.current) return;
    stopVoice();
    setSidebarOpen(false);
    setError("");
    setMemory(null);
    setLoading(true);
    const load = ++loadRef.current;
    try {
      const data = await jsonRequest<{ turns: Turn[] }>(`/api/conversations/${id}`);
      if (load !== loadRef.current) return;
      setConversationId(id);
      setTurns(data.turns);
      stickRef.current = true;
    } catch (e) {
      if (load === loadRef.current)
        setError(e instanceof Error ? e.message : "Could not open conversation.");
    } finally {
      if (load === loadRef.current) setLoading(false);
    }
  }

  function newConversation() {
    if (busyRef.current) return;
    loadRef.current++;
    setLoading(false);
    stopVoice();
    setConversationId(null);
    setTurns([]);
    setDraft("");
    setMemory(null);
    setError("");
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(draft);
  }
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(draft);
    }
  }

  async function readAloud(text: string) {
    stopVoice();
    await playerRef.current?.unlock();
    const clean = speakable(text);
    const segments = clean.match(/.{1,550}(?:\s|$)/g) || [clean.slice(0, 1200)];
    for (const segment of segments) playerRef.current?.enqueue(segment);
  }

  const title = conversations.find((c) => c.id === conversationId)?.title;
  const listening = scribe.isConnected && !busy;
  const visibleConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(historyQuery.toLowerCase()),
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#composer"
        className="sr-only z-50 rounded-lg bg-zinc-900 p-3 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to message
      </a>
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-20 bg-black/15 md:hidden"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        id="conversation-sidebar"
        aria-label="Chat history"
        onKeyDown={(event) => {
          if (event.key === "Escape") setSidebarOpen(false);
        }}
        className={
          "fixed inset-y-0 left-0 z-30 flex w-56 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50 p-3 transition-transform motion-reduce:transition-none md:static md:translate-x-0 " +
          (sidebarOpen ? "translate-x-0" : "-translate-x-full max-md:invisible")
        }
      >
        <div className="mb-6 flex h-10 items-center justify-between px-1">
          <button
            className="flex items-center gap-1.5 text-lg font-semibold tracking-tight"
            aria-label="Minimi home"
            disabled={busy}
            onClick={newConversation}
          >
            <Brand /> minimi
          </button>
          <button
            className={iconButton + " md:hidden"}
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <button
          className="mb-6 flex h-10 items-center gap-2 rounded-lg px-3 text-left hover:bg-zinc-200/50"
          onClick={newConversation}
          disabled={busy}
        >
          <Plus size={17} /> New chat
        </button>
        {conversations.length > 4 && (
          <label className="mb-3 flex items-center gap-2 px-3 text-zinc-500">
            <Search size={14} />
            <input
              className="min-w-0 flex-1 bg-transparent py-1 text-xs text-zinc-700 outline-none"
              aria-label="Search conversations"
              placeholder="Search chats"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
          </label>
        )}
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Conversations">
          {visibleConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={
                "group flex items-center rounded-lg hover:bg-zinc-200/50 " +
                (conversation.id === conversationId ? "bg-zinc-200/60" : "")
              }
            >
              <button
                className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-[13px] text-zinc-600"
                onClick={() => void openConversation(conversation.id)}
                disabled={busy}
                aria-current={conversation.id === conversationId ? "page" : undefined}
              >
                {conversation.title}
              </button>
              <button
                className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                title="Delete conversation"
                aria-label={"Delete " + conversation.title}
                disabled={busy}
                onClick={async () => {
                  try {
                    await jsonRequest("/api/conversations/" + conversation.id, {
                      method: "DELETE",
                    });
                    if (conversation.id === conversationId) newConversation();
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not delete conversation.");
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!conversations.length && (
            <p className="px-3 text-xs text-zinc-500">Your chats will appear here.</p>
          )}
          {!!conversations.length && !visibleConversations.length && (
            <p className="px-3 text-xs text-zinc-500">No matching chats.</p>
          )}
        </nav>
        <button
          className="mt-3 flex h-10 items-center gap-2 rounded-lg px-3 text-[13px] text-zinc-500 hover:bg-zinc-200/50"
          onClick={() => {
            setSidebarOpen(false);
            setSettingsOpen(true);
          }}
        >
          <Settings2 size={16} /> Settings
        </button>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col" inert={sidebarOpen}>
        <header className="flex h-14 shrink-0 items-center gap-2 px-4 sm:px-6">
          <button
            className={iconButton + " md:hidden"}
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            aria-controls="conversation-sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeftOpen size={18} />
          </button>
          <span className="truncate text-xs text-zinc-500">{title || "New conversation"}</span>
        </header>
        <div
          className={
            "flex min-h-0 flex-1 flex-col " + (!turns.length ? "justify-center pb-[12dvh]" : "")
          }
        >
          {turns.length ? (
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              onScroll={() => {
                const element = scrollRef.current;
                if (element)
                  stickRef.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 120;
              }}
            >
              <h1 className="sr-only">{title || "Your conversation with Minimi"}</h1>
              <div className="mx-auto w-full max-w-2xl space-y-10 px-5 pt-6 pb-10 sm:px-8">
                {turns.map((turn, index) => (
                  <Answer
                    key={turn.id}
                    turn={turn}
                    active={busy && index === turns.length - 1}
                    status={status}
                    onSpeak={(text) => void readAloud(text)}
                    voiceAvailable={Boolean(config?.voice) && !busy}
                  />
                ))}
              </div>
            </div>
          ) : (
            <h1 className="mb-7 px-6 text-center text-[26px] font-medium tracking-tight text-zinc-800 sm:text-3xl">
              What’s on your mind?
            </h1>
          )}
          <div
            className={
              "mx-auto w-full max-w-2xl shrink-0 px-4 sm:px-8 " +
              (turns.length ? "pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]" : "")
            }
          >
            {memory && busy && <MemoryIndicator count={memory.count} anchors={memory.anchors} />}
            {error && (
              <div
                className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"
                role="alert"
              >
                <span className="min-w-0 flex-1">{error}</span>
                <button
                  className="shrink-0 p-0.5"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <form
              id="composer"
              tabIndex={-1}
              className="flex min-h-14 items-end gap-1 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xs transition-[border-color,box-shadow] focus-within:border-zinc-300 focus-within:shadow-sm motion-reduce:transition-none"
              onSubmit={handleSubmit}
              aria-label="Message composer"
            >
              {voiceMode ? (
                <VoiceActivity
                  state={
                    speaking
                      ? "speaking"
                      : busy
                        ? "thinking"
                        : listening
                          ? "listening"
                          : "connecting"
                  }
                  transcript={scribe.partialTranscript}
                  getTrack={getInputTrack}
                />
              ) : (
                <textarea
                  ref={textareaRef}
                  className="field-sizing-content max-h-36 min-h-9 min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-1.5 text-base leading-6 placeholder:text-zinc-500 focus-visible:outline-none sm:text-sm"
                  aria-label="Message Minimi"
                  placeholder="Ask anything…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKey}
                  rows={1}
                  maxLength={12000}
                  disabled={loading}
                />
              )}
              <button
                type="button"
                className={iconButton + (voiceMode ? " bg-zinc-100 text-zinc-800" : "")}
                aria-label={voiceMode ? "End voice conversation" : "Start voice conversation"}
                title={voiceMode ? "End voice" : "Talk to Minimi"}
                aria-pressed={voiceMode}
                onClick={() => void toggleVoice()}
                disabled={loading}
              >
                {voiceMode ? <X size={18} /> : <AudioLines size={19} />}
              </button>
              {busy || speaking ? (
                <button
                  type="button"
                  className={
                    iconButton + " bg-zinc-800 text-white hover:bg-zinc-700 hover:text-white"
                  }
                  aria-label={busy ? "Stop answer" : "Stop audio"}
                  title={voiceMode ? "Interrupt" : "Stop"}
                  onClick={() => {
                    abortRef.current?.abort();
                    playerRef.current?.stop();
                  }}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                !voiceMode && (
                  <button
                    type="submit"
                    className={
                      iconButton +
                      " bg-zinc-800 text-white hover:bg-zinc-700 hover:text-white disabled:bg-zinc-100 disabled:text-zinc-500 disabled:opacity-100"
                    }
                    disabled={!draft.trim() || loading}
                    aria-label="Send message"
                    title="Send message"
                  >
                    <ArrowUp size={18} />
                  </button>
                )
              )}
            </form>
            {!turns.length && (
              <div
                className={
                  "mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 " +
                  (voiceMode ? "invisible" : "")
                }
                inert={voiceMode}
                aria-label="Suggested prompts"
              >
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.title}
                    className="py-1 text-xs text-zinc-500 hover:text-zinc-700"
                    disabled={loading || busy}
                    onClick={() => {
                      setDraft(suggestion.text);
                      textareaRef.current?.focus();
                    }}
                  >
                    {suggestion.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      {settingsOpen && (
        <Settings
          config={config}
          turns={turns}
          autoSpeak={autoSpeak}
          onClose={() => setSettingsOpen(false)}
          onAutoSpeak={async () => {
            if (!autoSpeak) await playerRef.current?.unlock();
            else playerRef.current?.stop();
            autoSpeakRef.current = !autoSpeak;
            setAutoSpeak(!autoSpeak);
          }}
        />
      )}
    </div>
  );
}

const iconButton =
  "flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700";

function Settings({
  config,
  turns,
  autoSpeak,
  onClose,
  onAutoSpeak,
}: {
  config: Config | null;
  turns: Turn[];
  autoSpeak: boolean;
  onClose: () => void;
  onAutoSpeak: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog
      aria-labelledby="settings-title"
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-xl backdrop:bg-black/20"
    >
      <div onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-medium" id="settings-title">
            Settings
          </h2>
          <button className={iconButton} aria-label="Close settings" onClick={onClose} autoFocus>
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">
          {[
            { name: "Chat", ready: config?.chat },
            { name: "Web search", ready: config?.search },
            { name: "Voice", ready: config?.voice },
          ].map(({ name, ready }) => (
            <div key={name} className="flex items-center justify-between text-xs">
              <span>{name}</span>
              <span className={ready ? "text-zinc-500" : "text-amber-700"}>
                {ready ? "Connected" : "Not configured"}
              </span>
            </div>
          ))}
        </div>
        {(!config?.chat || !config?.search || !config?.voice) && (
          <p className="mt-5 text-xs leading-5 text-zinc-500">
            Add your API keys to <code className="text-zinc-600">.env</code> using{" "}
            <code className="text-zinc-600">.env.example</code>, then restart the app.
          </p>
        )}
        <label className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-5 text-xs">
          Read replies aloud
          <input
            type="checkbox"
            className="size-3.5 accent-violet-600"
            checked={autoSpeak}
            disabled={!config?.voice}
            onChange={onAutoSpeak}
          />
        </label>
        {turns.length > 0 && (
          <button
            className="mt-5 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-800"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(turns, null, 2)], { type: "application/json" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "minimi-conversation.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <Download size={14} /> Export conversation
          </button>
        )}
      </div>
    </dialog>
  );
}
