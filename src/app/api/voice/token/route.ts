import { settings, AppError } from "@/server/config";
import { ownerId, sameOrigin, rateLimit, errorResponse } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    rateLimit(await ownerId(), "voice-token", 10);
    const key = settings().voiceKey;
    if (!key) throw new AppError("Add ELEVENLABS_API_KEY to .env and restart to use voice.", 503);
    const response = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": key },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "ElevenLabs could not start voice. Check your key, credits, and speech-to-text permissions.",
        502,
      );
    }
    const data = await response.json();
    if (typeof data.token !== "string")
      throw new AppError("ElevenLabs returned an invalid voice token.", 502);
    return Response.json({ token: data.token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
