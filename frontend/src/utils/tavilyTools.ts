import { tool } from "ai";
import { z } from "zod";
import { secureGetItem } from "./secureStorage.js";

const TAVILY_BASE_URL = "https://api.tavily.com";

const tavilyOptionsSchema = z
  .object({
    searchDepth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).optional(),
    maxResults: z.number().min(1).max(20).optional(),
    includeAnswer: z.enum(["none", "basic", "advanced"]).optional(),
    includeRawContent: z.enum(["none", "markdown", "text"]).optional(),
    topic: z.enum(["general", "news", "finance"]).optional(),
    timeRange: z.enum(["day", "week", "month", "year"]).nullable().optional(),
    exactMatch: z.boolean().optional(),
    chunksPerSource: z.number().min(1).max(3).optional(),
  })
  .catchall(z.unknown());

export type TavilyToolOptions = z.infer<typeof tavilyOptionsSchema>;

async function getApiKey(): Promise<string> {
  return (await secureGetItem("tavily-api-key")) || "";
}

export function parseTavilyOptions(
  value: unknown,
): TavilyToolOptions | Record<string, never> {
  const result = tavilyOptionsSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  return {};
}

function getOptions(): TavilyToolOptions | Record<string, never> {
  try {
    const raw = localStorage.getItem("tavily-options");
    if (raw) {
      return parseTavilyOptions(JSON.parse(raw));
    }
  } catch {
    // ignore
  }
  return {};
}

type TavilyApiKeySource = string | (() => string | Promise<string>);
type TavilyOptionsSource = unknown | (() => unknown);

async function resolveApiKey(source: TavilyApiKeySource): Promise<string> {
  return typeof source === "function" ? await source() : source;
}

function resolveOptions(source?: TavilyOptionsSource): unknown {
  return typeof source === "function" ? source() : source;
}

async function tavilyRequest(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<unknown> {
  if (!apiKey) throw new Error("Tavily API key not configured");

  const response = await fetch(`${TAVILY_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as {
      detail?: { error?: string };
    } | null;
    throw new Error(
      err?.detail?.error || `Tavily API error: ${response.status}`,
    );
  }

  return response.json();
}

const searchParams = z.object({
  query: z.string().describe("The search query to execute."),
  maxResults: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Maximum number of search results to return. Defaults to the user settings.",
    ),
  timeRange: z
    .enum(["day", "week", "month", "year"])
    .optional()
    .describe("Filter results by time range."),
});

type SearchParams = z.infer<typeof searchParams>;

export function createTavilySearchTool(config: {
  apiKey: TavilyApiKeySource;
  options?: TavilyOptionsSource;
}) {
  return tool({
    description:
      "Search the web for current and relevant information using Tavily. Use this tool when you need up-to-date facts, news, or context from the internet. Always cite the sources you use.",
    inputSchema: searchParams,
    execute: async ({ query, maxResults, timeRange }: SearchParams) => {
      const opts = parseTavilyOptions(resolveOptions(config.options));

      const includeAnswer = opts.includeAnswer as string | undefined;
      const includeRawContent = opts.includeRawContent as string | undefined;

      const response = await tavilyRequest(
        "/search",
        {
          query,
          search_depth: (opts.searchDepth as any) ?? "basic",
          max_results: maxResults ?? (opts.maxResults as number) ?? 5,
          include_answer:
            includeAnswer === "none"
              ? false
              : ((includeAnswer as any) ?? false),
          include_raw_content:
            includeRawContent === "none"
              ? false
              : ((includeRawContent as any) ?? "markdown"),
          topic: (opts.topic as any) ?? "general",
          time_range: timeRange ?? (opts.timeRange as any) ?? undefined,
          exact_match: (opts.exactMatch as boolean) ?? false,
          chunks_per_source: (opts.chunksPerSource as number) ?? 3,
        },
        await resolveApiKey(config.apiKey),
      );

      const res = response as Record<string, any>;
      const results = (res.results || [])
        .map(
          (r: any, i: number) =>
            `[${i + 1}] **${r.title}**\nURL: ${r.url}\nContent: ${r.content ?? "N/A"}\n${
              r.raw_content ? `Raw Content:\n${r.raw_content}\n` : ""
            }`,
        )
        .join("\n\n");

      const answer = res.answer ? `\n\nGenerated Answer: ${res.answer}` : "";

      return `Tavily Search Results for "${query}":\n\n${results}${answer}`;
    },
  });
}

const extractParams = z.object({
  urls: z
    .preprocess((val) => {
      // Some models serialize arrays as JSON strings; defensively parse them.
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Not a JSON string — treat it as a single URL.
        }
        return [val];
      }
      return val;
    }, z.array(z.string().url()).min(1).max(20))
    .describe("List of URLs to extract content from (max 20)."),
  query: z
    .string()
    .optional()
    .describe("Optional user intent query to rerank extracted content chunks."),
  extractDepth: z
    .enum(["basic", "advanced"])
    .optional()
    .describe(
      "Depth of extraction. advanced retrieves more data including tables.",
    ),
});

type ExtractParams = z.infer<typeof extractParams>;

export function createTavilyExtractTool(config: {
  apiKey: TavilyApiKeySource;
}) {
  return tool({
    description:
      "Extract detailed raw content from one or more specific URLs using Tavily Extract. Use this tool when you need to read the full content of a web page that was found via search or provided by the user. Returns the raw text/markdown of each page.",
    inputSchema: extractParams,
    execute: async ({ urls, query, extractDepth }: ExtractParams) => {
      const response = await tavilyRequest(
        "/extract",
        {
          urls,
          query,
          extract_depth: extractDepth ?? "basic",
          format: "markdown",
        },
        await resolveApiKey(config.apiKey),
      );

      const res = response as Record<string, any>;
      const results = (res.results || [])
        .map(
          (r: any) =>
            `URL: ${r.url}\n\n${r.raw_content ?? "No content extracted."}`,
        )
        .join("\n\n---\n\n");

      const failed = res.failedResults?.length
        ? `\n\nFailed URLs:\n${res.failedResults.map((f: any) => `- ${f.url}: ${f.error}`).join("\n")}`
        : "";

      return `Tavily Extract Results:\n\n${results}${failed}`;
    },
  });
}

export const tavilySearchTool = createTavilySearchTool({
  apiKey: getApiKey,
  options: getOptions,
});

export const tavilyExtractTool = createTavilyExtractTool({
  apiKey: getApiKey,
});
