import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSearchSettings } from "./useSearchSettings";
import { secureSetItem } from "@/utils/secureStorage";

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("useSearchSettings", () => {
  let store: Record<string, string> = {};
  let originalLocalStorage: any;

  beforeEach(() => {
    originalLocalStorage = (globalThis as any).localStorage;
    store = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  it("defaults to native engine", () => {
    const settings = useSearchSettings();
    expect(settings.engine.value).toBe("native");
    expect(settings.tavilyApiKey.value).toBe("");
    expect(settings.options.value.searchDepth).toBe("basic");
    expect(settings.options.value.includeAnswer).toBe("none");
    expect(settings.options.value.maxResults).toBe(5);
  });

  it("reads saved engine from localStorage", () => {
    store["search-engine"] = "tavily";
    const settings = useSearchSettings();
    expect(settings.engine.value).toBe("tavily");
  });

  it("reads saved tavily api key from localStorage", async () => {
    await secureSetItem("tavily-api-key", "tvly-test");
    const settings = useSearchSettings();
    await flushPromises();
    expect(settings.tavilyApiKey.value).toBe("tvly-test");
  });

  it("reads saved tavily options from localStorage", () => {
    store["tavily-options"] = JSON.stringify({
      searchDepth: "advanced",
      maxResults: 10,
      includeAnswer: "advanced",
      includeRawContent: "text",
      topic: "news",
      timeRange: "week",
      exactMatch: true,
      chunksPerSource: 2,
    });
    const settings = useSearchSettings();
    expect(settings.options.value.searchDepth).toBe("advanced");
    expect(settings.options.value.maxResults).toBe(10);
    expect(settings.options.value.includeAnswer).toBe("advanced");
    expect(settings.options.value.includeRawContent).toBe("text");
    expect(settings.options.value.topic).toBe("news");
    expect(settings.options.value.timeRange).toBe("week");
    expect(settings.options.value.exactMatch).toBe(true);
    expect(settings.options.value.chunksPerSource).toBe(2);
  });

  const searchCapableModel = {
    label: "Search Model",
    value: "venice/with-search",
    supportsImages: true,
    supportsSearch: true,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
  };
  const plainModel = {
    label: "Plain Model",
    value: "venice/plain",
    supportsImages: false,
    supportsSearch: false,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
  };
  const allModels = [searchCapableModel, plainModel];

  it("isSearchAvailable returns supportsSearch for native engine", () => {
    const settings = useSearchSettings();
    expect(settings.isSearchAvailable.value(allModels, "venice/with-search")).toBe(true);
    expect(settings.isSearchAvailable.value(allModels, "venice/plain")).toBe(false);
    expect(settings.isSearchAvailable.value(allModels, "unknown/model")).toBe(false);
  });

  it("isSearchAvailable returns true for all models when tavily is configured", async () => {
    store["search-engine"] = "tavily";
    await secureSetItem("tavily-api-key", "tvly-test");
    const settings = useSearchSettings();
    await flushPromises();
    expect(settings.isSearchAvailable.value(allModels, "venice/with-search")).toBe(true);
    expect(settings.isSearchAvailable.value(allModels, "venice/plain")).toBe(true);
  });

  it("isSearchAvailable returns false for tavily when api key is missing", () => {
    store["search-engine"] = "tavily";
    const settings = useSearchSettings();
    expect(settings.isSearchAvailable.value(allModels, "venice/with-search")).toBe(false);
  });

  it("saveEngine persists to localStorage", () => {
    const settings = useSearchSettings();
    settings.saveEngine("tavily");
    expect(store["search-engine"]).toBe("tavily");
    expect(settings.engine.value).toBe("tavily");
  });

  it("saveTavilyKey persists the stored value to localStorage", async () => {
    const settings = useSearchSettings();
    await settings.saveTavilyKey("tvly-abc");
    expect(settings.tavilyApiKey.value).toBe("tvly-abc");
    expect(store["tavily-api-key"]).toBe("tvly-abc");
  });

  it("saveTavilyKey removes key when empty", async () => {
    await secureSetItem("tavily-api-key", "tvly-abc");
    const settings = useSearchSettings();
    await settings.saveTavilyKey("");
    expect(store["tavily-api-key"]).toBeUndefined();
  });

  it("saveTavilyOptions persists partial updates", () => {
    const settings = useSearchSettings();
    settings.saveTavilyOptions({ searchDepth: "advanced", maxResults: 8 });
    const saved = JSON.parse(store["tavily-options"]!);
    expect(saved.searchDepth).toBe("advanced");
    expect(saved.maxResults).toBe(8);
    expect(saved.includeAnswer).toBe("none");
  });
});
