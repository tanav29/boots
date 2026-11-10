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
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Download,
  Globe2,
  History,
  Info,
  Menu,
  MessageCircle,
  Mic,
  Plus,
  Search,
  Settings2,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AgentEvent, Conversation, Turn } from "@/lib/types";
import { SpeechPlayer } from "@/lib/speech-player";
import { speakable } from "@/lib/voice-text";
import { Answer, MemoryIndicator } from "./answer";
import { Brand } from "./brand";

type Config = { chat: boolean; search: boolean; voice: boolean; model: string };
const suggestions = [
  {
    icon: Globe2,
    title: "Research something new",
    text: "Compare CRM tools for a 20-person sales team. Check current pricing and explain your shortlist.",
    hint: "Current answers, with sources",
  },
  {
    icon: History,
    title: "Revisit an earlier answer",
    text: "What did I ask you last Tuesday? Is your answer still correct today?",
    hint: "Pick up an old conversation",
  },
  {
    icon: Search,
    title: "See what’s changed",
    text: "Have any of the tools we discussed changed their pricing or shipped something big since?",
    hint: "A fresh look at an old shortlist",
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
  const [copiedSetup, setCopiedSetup] = useState(false);
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
    onError: () => {
      voiceModeRef.current = false;
      setVoiceMode(false);
      setError(
        "Could not connect the microphone. Check browser permissions and your ElevenLabs key and credits.",
      );
    },
  });
  useEffect(() => {
    disconnectRef.current = scribe.disconnect;
  }, [scribe.disconnect]);

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

  useEffect(() => {
    const element = textareaRef.current;
    if (element) {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
    }
  }, [draft]);

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
      setError(e instanceof Error ? e.message : "Could not start the microphone.");
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
    <div className="app-shell">
      <a href="#composer" className="skip-link" inert={settingsOpen}>
        Skip to message
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`} inert={settingsOpen}>
        <button
          className="wordmark"
          onClick={newConversation}
          aria-label="Minimi home"
          disabled={busy}
        >
          <Brand />
          <span>
            minimi<span className="brand-period">.</span>
          </span>
        </button>
        <button className="new-chat" onClick={newConversation} disabled={busy}>
          <Plus size={17} />
          New conversation
        </button>
        <div className="sidebar-section">
          <span>Your conversations</span>
          <History size={13} />
        </div>
        {conversations.length > 4 && (
          <label className="history-search">
            <Search size={14} />
            <input
              aria-label="Search conversations"
              placeholder="Find a conversation"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
          </label>
        )}
        <nav className="conversation-list" aria-label="Conversations">
          {visibleConversations.map((conversation) => (
            <div
              className={`conversation-row ${conversation.id === conversationId ? "selected" : ""}`}
              key={conversation.id}
            >
              <button onClick={() => void openConversation(conversation.id)} disabled={busy}>
                <MessageCircle size={15} />
                <span>{conversation.title}</span>
              </button>
              <button
                className="delete-chat"
                title="Delete conversation"
                aria-label={`Delete ${conversation.title}`}
                disabled={busy}
                onClick={async () => {
                  try {
                    await jsonRequest(`/api/conversations/${conversation.id}`, {
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
            <div className="history-empty">
              <MessageCircle size={22} strokeWidth={1.25} />
              <p>A space for your thoughts.</p>
              <span>Your conversations will appear here.</span>
            </div>
          )}
          {conversations.length > 0 && !visibleConversations.length && (
            <p className="muted small">No matching conversations.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="memory-note">
            <span className="memory-icon">
              <History size={17} />
            </span>
            <div>
              <strong>A little memory goes a long way.</strong>
              <p>Past conversations give new questions context.</p>
            </div>
          </div>
          <button className="settings-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} />
            <span>Settings & connections</span>
            <ChevronRight size={14} />
          </button>
          <div className="local-profile">
            <span className="avatar">Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Saved in this browser’s session</small>
            </div>
            <span className="local-dot" title="Private browser session" />
          </div>
        </div>
      </aside>

      <main className="main" inert={settingsOpen}>
        {turns.length > 0 && (
          <h1 className="sr-only">{title || "Your conversation with Minimi"}</h1>
        )}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>{title || "A conversation with context"}</span>
          </div>
          <div className="topbar-right">
            <span className="web-status">
              <span className={config?.search ? "online-dot" : "offline-dot"} />
              {config?.search ? "Web connected" : "Web search"}
            </span>
            <span className="topbar-divider" />
            <button
              className={`voice-toggle ${voiceMode ? "enabled" : ""}`}
              onClick={() => void toggleVoice()}
              disabled={loading}
            >
              <AudioLines size={16} />
              <span>{voiceMode ? "End voice" : "Voice"}</span>
            </button>
          </div>
        </header>

        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={() => {
            const element = scrollRef.current;
            if (element)
              stickRef.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 120;
          }}
        >
          <div className={`chat-content ${turns.length ? "has-messages" : "is-empty"}`}>
            {!turns.length ? (
              <section className="welcome">
                <div className="welcome-symbol">
                  <Brand />
                </div>
                <h1>
                  Pick up where
                  <br />
                  you left off.
                </h1>
                <p>
                  New questions. A fresh perspective.
                  <br />
                  An assistant that remembers the conversation.
                </p>
                <div className="suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.title}
                      disabled={loading || busy}
                      onClick={() => {
                        setDraft(suggestion.text);
                        textareaRef.current?.focus();
                      }}
                    >
                      <suggestion.icon size={18} strokeWidth={1.6} />
                      <span>
                        <strong>{suggestion.title}</strong>
                        <small>{suggestion.hint}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <div className="conversation-date">
                  {new Date(turns[0].createdAt).toLocaleDateString([], {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
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
              </>
            )}
          </div>
        </div>

        <div className="composer-area">
          <div className="composer-container">
            {memory && busy && <MemoryIndicator count={memory.count} anchors={memory.anchors} />}
            {error && (
              <div className="error-notice" role="alert">
                <Info size={16} />
                <span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            {voiceMode && (
              <div className="voice-panel">
                <div
                  className={`voice-bars ${listening || speaking ? "animated" : ""}`}
                  aria-hidden="true"
                >
                  {[0, 1, 2, 3, 4].map((i) => (
                    <i key={i} />
                  ))}
                </div>
                <div>
                  <strong>
                    {speaking
                      ? "Minimi is speaking"
                      : busy
                        ? "Finding your answer"
                        : listening
                          ? "Listening to you"
                          : "Connecting microphone"}
                  </strong>
                  <span>
                    {listening
                      ? scribe.partialTranscript || "Speak naturally. I’ll respond when you pause."
                      : speaking
                        ? "Only the answer is read aloud."
                        : "Your conversation continues here."}
                  </span>
                </div>
                {(busy || speaking) && (
                  <button
                    onClick={() => {
                      abortRef.current?.abort();
                      playerRef.current?.stop();
                    }}
                  >
                    Interrupt
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="End voice conversation"
                  onClick={stopVoice}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <form className={`composer ${voiceMode ? "voice-active" : ""}`} onSubmit={handleSubmit}>
              <textarea
                ref={textareaRef}
                id="composer"
                aria-label="Message Minimi"
                placeholder={
                  listening
                    ? "Listening… or type a message"
                    : "Ask anything, or pick up a conversation…"
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                maxLength={12000}
                disabled={loading}
              />
              <div className="composer-toolbar">
                <div className="composer-tools">
                  <span className="research-label">
                    <Globe2 size={14} />
                    Web search
                  </span>
                  <span className="composer-tool-divider" />
                  <button
                    type="button"
                    className={`composer-audio ${autoSpeak ? "active" : ""}`}
                    title={autoSpeak ? "Turn off spoken answers" : "Read answers aloud"}
                    aria-label={autoSpeak ? "Turn off spoken answers" : "Read answers aloud"}
                    aria-pressed={autoSpeak}
                    onClick={async () => {
                      if (!config?.voice) {
                        setSettingsOpen(true);
                        return;
                      }
                      if (!autoSpeak) await playerRef.current?.unlock();
                      else playerRef.current?.stop();
                      autoSpeakRef.current = !autoSpeak;
                      setAutoSpeak(!autoSpeak);
                    }}
                  >
                    {autoSpeak ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                  {speaking && !voiceMode && (
                    <button
                      type="button"
                      className="stop-speaking"
                      onClick={() => playerRef.current?.stop()}
                    >
                      Stop audio
                    </button>
                  )}
                </div>
                <div className="send-tools">
                  <button
                    type="button"
                    className={`mic-button ${voiceMode ? "active" : ""}`}
                    aria-label={voiceMode ? "End voice conversation" : "Start voice conversation"}
                    title="Talk to Minimi"
                    onClick={() => void toggleVoice()}
                    disabled={loading}
                  >
                    <Mic size={18} />
                  </button>
                  {busy ? (
                    <button
                      type="button"
                      className="send-button"
                      aria-label="Stop answer"
                      title="Stop answer"
                      onClick={() => {
                        abortRef.current?.abort();
                        playerRef.current?.stop();
                      }}
                    >
                      <Square size={13} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="send-button"
                      disabled={!draft.trim() || loading}
                      aria-label="Send message"
                      title="Send message"
                    >
                      <ArrowUp size={19} />
                    </button>
                  )}
                </div>
              </div>
            </form>
            <div className="composer-footer">
              <span>Thoughtful answers. Check the sources.</span>
              <span>Shift + Enter for a new line</span>
            </div>
          </div>
        </div>
      </main>

      {settingsOpen && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettingsOpen(false);
              if (e.key === "Tab") {
                const buttons =
                  e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="modal-heading">
              <div>
                <h2 id="settings-title">A few connections.</h2>
                <p>Your keys stay on the server.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Close settings"
                autoFocus
                onClick={() => setSettingsOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="connection-list">
              {[
                {
                  name: "OpenRouter",
                  detail: config?.model || "The language model",
                  ready: config?.chat,
                },
                {
                  name: "Exa",
                  detail: "Live web search & source passages",
                  ready: config?.search,
                },
                {
                  name: "ElevenLabs",
                  detail: "Live transcription & spoken answers",
                  ready: config?.voice,
                },
              ].map((connection) => (
                <div key={connection.name}>
                  <span className={`connection-icon ${connection.ready ? "ready" : ""}`}>
                    {connection.ready ? <Check size={16} /> : <Plus size={16} />}
                  </span>
                  <span>
                    <strong>{connection.name}</strong>
                    <small>{connection.detail}</small>
                  </span>
                  <span className="connection-state">
                    {connection.ready ? "Configured" : "Key needed"}
                  </span>
                </div>
              ))}
            </div>
            <div className="setup-instructions">
              <strong>Set up your workspace</strong>
              <p>
                Copy <code>.env.example</code> to <code>.env</code>, add your API keys, then restart
                the app.
              </p>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      "OPENROUTER_API_KEY=\nEXA_API_KEY=\nELEVENLABS_API_KEY=",
                    );
                    setCopiedSetup(true);
                    setTimeout(() => setCopiedSetup(false), 2000);
                  } catch {}
                }}
              >
                {copiedSetup ? <Check size={14} /> : <CopyIcon />}{" "}
                {copiedSetup ? "Copied" : "Copy variable names"}
              </button>
            </div>
            <div className="privacy-note">
              <History size={17} />
              <p>
                Conversation history is stored locally on this server and scoped to your browser
                session. Relevant context is sent to OpenRouter; searches go to Exa; voice goes to
                ElevenLabs. Deleting a conversation removes it from memory.
              </p>
            </div>
            {turns.length > 0 && (
              <button
                className="export-button"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(turns, null, 2)], { type: "application/json" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "minimi-conversation.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={15} />
                Export this conversation
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </svg>
  );
}
