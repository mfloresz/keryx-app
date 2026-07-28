import { nextTick, ref } from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("useLanguage", () => {
  let store: Record<string, string> = {};
  let originalLocalStorage: any;
  let originalNavigator: any;
  let originalDocumentLang: string;
  let localeRef: ReturnType<typeof ref>;

  async function loadUseLanguage() {
    vi.resetModules();
    localeRef = ref("en");

    vi.doMock("vue-i18n", () => ({
      useI18n: () => ({ locale: localeRef }),
    }));

    return import("./useLanguage");
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
    vi.restoreAllMocks();
    vi.unmock("vue-i18n");
  });

  it("starts in the browser language when no preference is saved", async () => {
    const { useLanguage } = await loadUseLanguage();
    const settings = useLanguage();

    expect(settings.locale.value).toBe("es");
    expect(localeRef.value).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("persists and applies a locale change from settings", async () => {
    const { useLanguage } = await loadUseLanguage();
    const settings = useLanguage();

    settings.setLocale("en");
    await nextTick();

    expect(store["app-locale"]).toBe("en");
    expect(localeRef.value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
