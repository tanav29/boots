import { ownerId, errorResponse, sameOrigin } from "@/server/http";
import { store } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const owner = await ownerId();
    return Response.json(
      { turns: store().turns(owner, (await params).id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    store().delete(await ownerId(), (await params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
