# Minimi

A Next.js chat agent built around a difficult question: **“Is what you told me last week still true?”**

It remembers exact dated conversations, researches the live web through one tool, and gives cited answers. OpenRouter runs the model. ElevenLabs provides live microphone transcription and streamed spoken responses. The UI keeps research activity separate from the answer; only answer text is spoken.

## Run

Requires **Node.js 22.13+** (Node 24 recommended; uses built-in SQLite).

```sh
npm install
cp .env.example .env
# Add your keys to .env
npm run dev
```

PowerShell: use `Copy-Item .env.example .env`. Open http://localhost:3000.

| Variable                    | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`        | Required: model inference                                            |
| `EXA_API_KEY`               | Required for live web research                                       |
| `ELEVENLABS_API_KEY`        | Optional for text chat; required for voice                           |
| `OPENROUTER_MODEL`          | Defaults to `anthropic/claude-sonnet-4.6`; must support tool calling |
| `OPENROUTER_RESEARCH_MODEL` | Optional separate tool-capable research model                        |
| `ELEVENLABS_VOICE_ID`       | Optional voice override                                              |
| `ELEVENLABS_TTS_MODEL`      | Defaults to `eleven_flash_v2_5`                                      |
| `DATABASE_PATH`             | Defaults to `./data/minimi.sqlite`                                   |

All keys are server-side. Missing keys produce actionable errors, never fabricated demo answers. OpenRouter and Exa are required for the full challenge experience. Voice needs an ElevenLabs key permitted to use single-use tokens, Scribe realtime, and text-to-speech, and sufficient account credits. Microphone input requires localhost or HTTPS and browser permission.

## Try it

1. Ask: “Compare five CRM tools for a 20-person sales team. Check current pricing.”
2. Start a new conversation and ask: “Which five did we shortlist, and why?” Memory crosses conversations in the same browser session.
3. Ask: “Has any pricing or major feature changed since that answer? Tell me what you can actually verify.”
4. Turn on **Voice**, speak, and pause. Scribe transcribes live; the model researches; ElevenLabs starts reading answer sentences as they arrive. The microphone reconnects after playback for the next turn. **Interrupt** stops the answer/audio and returns to listening. This is deliberate turn-taking, with tap-to-interrupt, rather than full-duplex echo-sensitive audio.
5. The speaker toggle reads typed replies too. Individual answers can also be read aloud.

The agent can only recall conversations actually saved in this installation and browser session. On a fresh installation, “What did I ask on 3 November?” should produce an honest missing-history response. The deterministic tests seed historical records to exercise those cases without waiting a week.

## How the code is organized

```text
src/server/agent.ts                 Bounded research loop and streamed answer orchestration
src/server/store.ts                 SQLite, FTS5, ownership, run leases, exact turn/source persistence
src/server/time.ts                  User-timezone calendar dates and daylight-saving boundaries
src/server/prompts.ts               Evidence, history, and temporal comparison policy
src/server/providers/openrouter.ts  Typed OpenRouter adapter and SSE parser
src/server/providers/search.ts      The sole tool: Exa web_search
src/lib/voice-text.ts                Public-text filtering and speech segmentation
src/app/api/                        Small validated HTTP route handlers
src/lib/speech-player.ts             Incremental PCM playback, scheduling, cancellation
src/components/                     Chat UI, citations, source inspection, voice controls
tests/                              Deterministic architecture/regression tests
scripts/live-eval.ts                Opt-in real-provider temporal evaluation
```

See [DESIGN.md](DESIGN.md) for decisions, tradeoffs, and next steps.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use real SQLite and injected provider adapters; they don't spend API credits. They check local-day recall, DST, cross-conversation retrieval, owner isolation, deletion, concurrent requests, parallel searches, search failures, bounded tool use, cancellation, fragmented SSE, Unicode, and speech isolation. They do **not** prove that a real model will always choose the right sources or interpret every ambiguous date correctly.

After adding keys, optionally run `npm run test:live`. This spends provider credits and writes a local report under `test-results/`, including answers and sources for manual review. It uses an isolated in-memory history, not your chats. Check the report's factual accuracy, citation entailment, original shortlist coverage, and treatment of uncertainty.

## Persistence and deployment

Use `npm run build` then `npm start` on one Node server with a persistent writable disk. SQLite uses WAL mode and FTS5. Exact turns and retrieved source passages survive restarts. Partial answers are marked stopped/error and are never presented as completed historical evidence. Crashed active turns expire after four minutes. Deleting a conversation cascades to its search index and source snapshots.

An unguessable, HttpOnly, SameSite cookie scopes history to a browser. This is a local evaluation app, not a multi-user identity system: clearing the cookie loses access to that browser's history. Use the same hostname consistently. For a public service, add authentication, shared rate limits, retention controls, and a shared database before horizontal scaling. Don't deploy the SQLite file to an ephemeral serverless filesystem. Provider request and run deadlines, validated inputs, same-origin checks, per-session limits, and a unique active-turn constraint bound local failures and costs; these are not a substitute for production abuse protection.

## Provider references

- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [streaming](https://openrouter.ai/docs/api/reference/streaming), and [reasoning exclusion](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [Exa Search](https://exa.ai/docs/reference/search)
- [ElevenLabs realtime Scribe](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming), [single-use tokens](https://elevenlabs.io/docs/api-reference/tokens/create), and [streamed speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
