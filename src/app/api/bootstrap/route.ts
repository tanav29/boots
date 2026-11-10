import { ownerId, errorResponse } from "@/server/http";
import { settings } from "@/server/config";
import { store } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const owner = await ownerId();
    const config = settings();
    return Response.json(
      {
        conversations: store().list(owner),
        config: {
          chat: Boolean(config.openrouterKey),
          search: Boolean(config.searchKey),
          voice: Boolean(config.voiceKey),
          model: config.model,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
