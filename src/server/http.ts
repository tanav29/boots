import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { AppError, publicError } from "./config";

export async function ownerId() {
  const jar = await cookies();
  const existing = jar.get("minimi_session")?.value;
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const id = randomBytes(32).toString("hex");
  jar.set("minimi_session", id, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new AppError("Cross-origin requests are not allowed.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("Cross-site requests are not allowed.", 403);
}

const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(owner: string, lane: string, limit = 20) {
  const now = Date.now();
  if (buckets.size > 2000)
    for (const [key, value] of buckets) if (value.until < now) buckets.delete(key);
  const key = `${owner}:${lane}`;
  const entry = buckets.get(key);
  if (!entry || entry.until < now) {
    buckets.set(key, { count: 1, until: now + 60_000 });
    return;
  }
  if (++entry.count > limit)
    throw new AppError("Too many requests. Please wait a minute and try again.", 429);
}

export async function readJson(request: Request, max = 24_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("Expected a JSON request.", 415);
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new AppError("The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("The request is empty.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new AppError("The request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("The request is not valid JSON.", 400);
  }
}

export function errorResponse(error: unknown) {
  return Response.json(
    { error: publicError(error) },
    { status: error instanceof AppError ? error.status : 500 },
  );
}
