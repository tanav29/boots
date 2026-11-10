import { createParser } from "eventsource-parser";
import { z } from "zod";
import { settings, AppError } from "../config";
import { webSearchTool } from "./search";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_details?: unknown[];
};
export type Usage = { prompt_tokens?: number; completion_tokens?: number };
const completion = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string().max(12000) }),
              }),
            )
            .optional(),
          reasoning_details: z.array(z.unknown()).optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

async function request(messages: ModelMessage[], stream: boolean, signal: AbortSignal) {
  const config = settings();
  if (!config.openrouterKey)
    throw new AppError("Add OPENROUTER_API_KEY to .env and restart to start chatting.", 503);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    headers: {
      Authorization: `Bearer ${config.openrouterKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Title": "Minimi",
    },
    body: JSON.stringify({
      model: stream ? config.model : config.researchModel,
      messages,
      stream,
      max_tokens: stream ? 6000 : 3000,
      reasoning: { effort: "low", exclude: true },
      provider: { require_parameters: true },
      ...(stream
        ? { stream_options: { include_usage: true } }
        : { tools: [webSearchTool], tool_choice: "auto" }),
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      response.status === 401
        ? "OpenRouter rejected its API key. Check OPENROUTER_API_KEY."
        : response.status === 402
          ? "OpenRouter needs credits. Add credits to your account and retry."
          : response.status === 429
            ? "The model is busy. Try again shortly."
            : response.status === 404
              ? "OpenRouter could not find an available provider for this model and request. Check the model ID and provider availability."
              : "The model request failed. Check your OpenRouter model and try again.",
      502,
    );
  }
  return response;
}

export async function research(
  messages: ModelMessage[],
  signal: AbortSignal,
): Promise<{ message: ModelMessage; usage?: Usage }> {
  const response = await request(messages, false, signal);
  const data = completion.safeParse(await response.json());
  if (!data.success)
    throw new AppError("The model returned an unexpected response. Please retry.", 502);
  return {
    message: {
      role: "assistant" as const,
      content: data.data.choices[0].message.content || null,
      tool_calls: data.data.choices[0].message.tool_calls,
      // Some reasoning models require their opaque signed state on the next tool turn.
      // It stays server-side, never stored in memory, streamed, or sent to speech.
      reasoning_details: data.data.choices[0].message.reasoning_details,
    },
    usage: data.data.usage,
  };
}

export async function* parseModelStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ text?: string; usage?: Usage }> {
  const pending: { text?: string; usage?: Usage }[] = [];
  let finished = false;
  let failure: AppError | undefined;
  const parser = createParser({
    onEvent(event) {
      if (event.data === "[DONE]") {
        finished = true;
        return;
      }
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          failure = new AppError("The model connection failed while answering. Please retry.", 502);
          return;
        }
        const choice = data.choices?.[0];
        if (choice?.finish_reason === "error" || choice?.finish_reason === "length") {
          failure = new AppError(
            choice.finish_reason === "length"
              ? "The answer reached the response limit. Ask me to continue."
              : "The model stopped unexpectedly. Please retry.",
            502,
          );
        }
        // Deliberately ignore reasoning, reasoning_details, tool_calls and all other deltas.
        if (typeof choice?.delta?.content === "string")
          pending.push({ text: choice.delta.content });
        if (data.usage) pending.push({ usage: data.usage });
      } catch {
        failure = new AppError("The model sent an invalid stream. Please retry.", 502);
      }
    },
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        parser.feed(decoder.decode());
        break;
      }
      parser.feed(decoder.decode(value, { stream: true }));
      while (pending.length) yield pending.shift()!;
      if (failure) throw failure;
    }
    while (pending.length) yield pending.shift()!;
    if (failure) throw failure;
    if (!finished)
      throw new AppError("The connection ended before the answer finished. Please retry.", 502);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* answer(messages: ModelMessage[], signal: AbortSignal) {
  const response = await request(messages, true, signal);
  if (!response.body) throw new AppError("The model returned an empty response.", 502);
  yield* parseModelStream(response.body);
}
