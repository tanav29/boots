import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  APICallError,
  generateText,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolCallPart,
} from "ai";
import { settings, AppError } from "../config";
import { webSearchTool } from "./search";

export type Usage = Pick<LanguageModelUsage, "inputTokens" | "outputTokens">;
export type ResearchResult = {
  messages: ModelMessage[];
  toolCalls: Pick<ToolCallPart, "toolCallId" | "toolName" | "input">[];
  usage?: Usage;
};

function requestOptions(messages: ModelMessage[], streaming: boolean, signal: AbortSignal) {
  const config = settings();
  if (!config.openrouterKey)
    throw new AppError("Add OPENROUTER_API_KEY to .env and restart to start chatting.", 503);
  const openrouter = createOpenRouter({
    apiKey: config.openrouterKey,
    headers: { "X-OpenRouter-Title": "Minimi" },
  });
  return {
    model: openrouter(streaming ? config.model : config.researchModel),
    // AI SDK 7 accepts trusted system messages through instructions.
    instructions: messages.filter((message) => message.role === "system"),
    messages: messages.filter((message) => message.role !== "system"),
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    maxOutputTokens: streaming ? 6000 : 3000,
    // Keep retries explicit so the research budget and request deadline stay predictable.
    maxRetries: 0,
    providerOptions: {
      openrouter: {
        reasoning: { effort: "low", exclude: true },
        provider: { require_parameters: true },
      },
    },
  };
}

function modelError(error: unknown, streaming: boolean): Error {
  if (error instanceof AppError) return error;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return error;
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  return new AppError(
    status === 401
      ? "OpenRouter rejected its API key. Check OPENROUTER_API_KEY."
      : status === 402
        ? "OpenRouter needs credits. Add credits to your account and retry."
        : status === 429
          ? "The model is busy. Try again shortly."
          : status === 404
            ? "OpenRouter could not find an available provider for this model and request. Check the model ID and provider availability."
            : streaming
              ? "The model connection failed while answering. Please retry."
              : "The model request failed. Check your OpenRouter model and try again.",
    502,
  );
}

export async function research(
  messages: ModelMessage[],
  signal: AbortSignal,
): Promise<ResearchResult> {
  try {
    const result = await generateText({
      ...requestOptions(messages, false, signal),
      // Execution stays in the bounded worker pool in runAgent.
      tools: { web_search: webSearchTool },
      toolChoice: "auto",
    });
    if (result.finishReason === "length")
      throw new AppError("The research reached the response limit. Please try again.", 502);
    if (!["stop", "tool-calls"].includes(result.finishReason))
      throw new AppError("The model stopped unexpectedly. Please retry.", 502);
    return {
      // Preserve opaque provider reasoning metadata for subsequent tool turns.
      // These messages stay server-side and are never persisted or spoken.
      // The SDK may synthesize error results for invalid calls. runAgent owns all
      // tool results, including validation errors, so retain only assistant turns.
      messages: result.response.messages.filter((message) => message.role === "assistant"),
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  } catch (error) {
    signal.throwIfAborted();
    throw modelError(error, false);
  }
}

export async function* answer(
  messages: ModelMessage[],
  signal: AbortSignal,
): AsyncGenerator<{ text?: string; usage?: Usage }> {
  try {
    const result = streamText({
      ...requestOptions(messages, true, signal),
      onError: () => {}, // Errors are sanitized below before entering the public event stream.
    });
    let finished = false;
    for await (const part of result.fullStream) {
      signal.throwIfAborted();
      if (part.type === "text-delta") yield { text: part.text };
      else if (part.type === "error") throw part.error;
      else if (part.type === "abort")
        throw new DOMException("The model request was interrupted.", "AbortError");
      else if (part.type === "finish") {
        yield { usage: part.totalUsage };
        if (part.finishReason === "length")
          throw new AppError("The answer reached the response limit. Ask me to continue.", 502);
        if (part.finishReason !== "stop")
          throw new AppError("The connection ended before the answer finished. Please retry.", 502);
        finished = true;
      }
      // Reasoning, tools, and provider metadata never enter the answer/voice channel.
    }
    if (!finished)
      throw new AppError("The connection ended before the answer finished. Please retry.", 502);
  } catch (error) {
    signal.throwIfAborted();
    throw modelError(error, true);
  }
}
