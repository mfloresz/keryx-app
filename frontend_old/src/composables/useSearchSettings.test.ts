import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSearchSettings } from "./useSearchSettings";

const allModels = [
  {
    label: "Search Model",
    value: "venice/with-search",
    supportsImages: true,
    supportsSearch: true,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
  },
  {
    label: "Plain Model",
    value: "venice/plain",
    supportsImages: false,
    supportsSearch: false,
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
  },
];

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
  });

  it("isSearchAvailable returns supportsSearch for the model", () => {
    const settings = useSearchSettings();
    expect(settings.isSearchAvailable.value(allModels, "venice/with-search")).toBe(true);
    expect(settings.isSearchAvailable.value(allModels, "venice/plain")).toBe(false);
    expect(settings.isSearchAvailable.value(allModels, "unknown/model")).toBe(false);
  });

  it("clears legacy tavily keys from localStorage", async () => {
    store["search-engine"] = "tavily";
    store["tavily-api-key"] = "tvly-test";
    store["tavily-options"] = "{}";
    // Re-import to trigger the module-level cleanup with the stubbed storage
    vi.resetModules();
    await import("./useSearchSettings");
    expect(store["search-engine"]).toBeUndefined();
    expect(store["tavily-api-key"]).toBeUndefined();
    expect(store["tavily-options"]).toBeUndefined();
  });
});
