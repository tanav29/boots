import { z } from "zod";
import type { Source } from "@/lib/types";
import { settings, AppError } from "../config";

export const searchInput = z
  .object({
    query: z.string().trim().min(2).max(500),
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
    domains: z
      .array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i))
      .max(4)
      .optional(),
  })
  .refine((input) => !input.start_date || !input.end_date || input.start_date <= input.end_date, {
    message: "start_date must not be after end_date",
  });
export type SearchInput = z.infer<typeof searchInput>;

export const webSearchTool = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the public web. Call several times in parallel for independent entities. Retrieves source passages and URLs. Dates filter publication dates and can miss undated pricing pages: check current pricing WITHOUT date filters, then search dated release notes separately. Prefer official domains. This is your only tool.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A focused search query, naming the specific entity and what to verify.",
        },
        start_date: {
          type: "string",
          description: "Optional inclusive publication date YYYY-MM-DD.",
        },
        end_date: {
          type: "string",
          description: "Optional inclusive end publication date YYYY-MM-DD.",
        },
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional official domain restriction, e.g. neon.tech. Max 4.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

const resultSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      url: z.string(),
      highlights: z.array(z.string()).nullish(),
      text: z.string().nullish(),
      publishedDate: z.string().nullish(),
    }),
  ),
});

export async function webSearch(
  input: SearchInput,
  signal: AbortSignal,
): Promise<Omit<Source, "id">[]> {
  const key = settings().searchKey;
  if (!key)
    throw new AppError("Web search is not configured. Add EXA_API_KEY to .env and restart.", 503);
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      type: "auto",
      numResults: 5,
      // Use source excerpts rather than a second model's generated summary.
      // Live fetching matters for the challenge's "has pricing changed?" queries.
      contents: { highlights: { maxCharacters: 6500 }, maxAgeHours: 0, livecrawlTimeout: 10_000 },
      ...(input.start_date && { startPublishedDate: `${input.start_date}T00:00:00.000Z` }),
      // Exa's upper bound is a timestamp. Include the whole requested UTC day.
      ...(input.end_date && {
        endPublishedDate: new Date(
          Date.parse(`${input.end_date}T00:00:00.000Z`) + 86_400_000,
        ).toISOString(),
      }),
      ...(input.domains?.length && { includeDomains: input.domains }),
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      response.status === 401 || response.status === 403
        ? "Exa rejected its API key or permissions. Check EXA_API_KEY."
        : response.status === 402
          ? "Exa needs credits. Add credits to your account and retry."
          : response.status === 429
            ? "Exa reached its usage limit. Try again shortly."
            : "Exa web search is temporarily unavailable.",
      502,
    );
  }
  const parsed = resultSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError("Exa returned an unexpected search response.", 502);
  const retrievedAt = new Date().toISOString();
  return parsed.data.results
    .filter((result) => safeUrl(result.url))
    .map((result) => ({
      url: result.url,
      title: (result.title || new URL(result.url).hostname).slice(0, 300),
      // Query-focused excerpts come first: page introductions/navigation must not
      // crowd the actual pricing/release evidence out of the model's context.
      content: [...(result.highlights || []), result.text]
        .filter(Boolean)
        .join("\n\nPage excerpt:\n")
        .slice(0, 6500),
      publishedAt: result.publishedDate || null,
      retrievedAt,
      query: input.query,
    }))
    .filter((result) => result.content.trim());
}

export function safeUrl(value: string) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
