import { z } from "zod";
import { settings, AppError } from "@/server/config";
import { ownerId, sameOrigin, rateLimit, readJson, errorResponse } from "@/server/http";
import { speakable } from "@/lib/voice-text";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    rateLimit(await ownerId(), "speech", 120);
    const body = z
      .object({ text: z.string().min(1).max(1200), previousText: z.string().max(600).optional() })
      .safeParse(await readJson(request, 12_000));
    if (!body.success) throw new AppError("Invalid speech segment.", 400);
    const text = speakable(body.data.text);
    if (!text) return new Response(null, { status: 204 });
    const config = settings();
    if (!config.voiceKey)
      throw new AppError("Add ELEVENLABS_API_KEY to .env and restart to hear answers.", 503);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=pcm_24000`,
      {
        method: "POST",
        headers: { "xi-api-key": config.voiceKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: config.ttsModel,
          previous_text: body.data.previousText,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]),
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new AppError(
        "ElevenLabs could not speak this answer. Check your key, voice ID, and credits.",
        502,
      );
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store, no-transform",
        "X-Audio-Format": "pcm_s16le_24000",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
