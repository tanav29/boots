export function settings() {
  return {
    openrouterKey: process.env.OPENROUTER_API_KEY?.trim() || "",
    model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.6",
    researchModel:
      process.env.OPENROUTER_RESEARCH_MODEL ||
      process.env.OPENROUTER_MODEL ||
      "anthropic/claude-sonnet-4.6",
    searchKey: process.env.EXA_API_KEY?.trim() || "",
    voiceKey: process.env.ELEVENLABS_API_KEY?.trim() || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
    ttsModel: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
  };
}

export class AppError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export function publicError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "The request was interrupted or took too long. Please try again.";
  }
  return "Something went wrong while answering. Please try again.";
}
