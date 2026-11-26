import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("i18n initial locale", () => {
  let store: Record<string, string> = {};
  let originalLocalStorage: any;
  let originalNavigator: any;
  let originalDocumentLang: string;

  async function loadI18n() {
    vi.resetModules();
    return import("./i18n");
  }

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

    originalNavigator = (globalThis as any).navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "es-MX" },
      configurable: true,
    });

    originalDocumentLang = document.documentElement.lang;
    document.documentElement.lang = "en";
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
    document.documentElement.lang = originalDocumentLang;
  });

  it("uses the browser locale when nothing is saved", async () => {
    const { default: i18n } = await loadI18n();

    expect(i18n.global.locale.value).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("prefers the saved locale over the browser locale", async () => {
    store["app-locale"] = "en";

    const { default: i18n } = await loadI18n();

    expect(i18n.global.locale.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
