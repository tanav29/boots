import { z } from "zod";
import { ownerId, sameOrigin, rateLimit, readJson, errorResponse } from "@/server/http";
import { settings, AppError } from "@/server/config";
import { store } from "@/server/store";
import { runAgent } from "@/server/agent";
import { validTimezone } from "@/server/time";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;
const schema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  text: z.string().trim().min(1).max(12000),
  timezone: z.string().max(100).refine(validTimezone).default("UTC"),
});

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const owner = await ownerId();
    rateLimit(owner, "chat");
    const parsed = schema.safeParse(await readJson(request, 64_000));
    if (!parsed.success)
      throw new AppError("Send a message of 1–12,000 characters and a valid timezone.", 400);
    if (!settings().openrouterKey)
      throw new AppError("Add OPENROUTER_API_KEY to .env and restart to start chatting.", 503);
    const db = store();
    const conversationId = parsed.data.conversationId || db.create(owner);
    const turn = db.begin(owner, conversationId, parsed.data.text);
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(170_000)]);
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: AgentEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
            abort.abort();
          }
        };
        const heartbeat = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            } catch {
              closed = true;
              abort.abort();
            }
          }
        }, 12_000);
        try {
          await runAgent({ owner, turn, timezone: parsed.data.timezone, db, signal, emit });
        } finally {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
