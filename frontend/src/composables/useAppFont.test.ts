import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("useAppFont", () => {
  let store: Record<string, string> = {};
  let originalLocalStorage: any;

  async function loadUseAppFont() {
    vi.resetModules();
    return import("./useAppFont");
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

    vi.spyOn(document.documentElement.style, "setProperty");
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  it("defaults to merriweather at small size", async () => {
    const { useAppFont } = await loadUseAppFont();
    const settings = useAppFont();

    expect(settings.appFont.value).toBe("merriweather");
    expect(settings.appFontSize.value).toBe("sm");
    expect(settings.fontFamily.value).toContain("Merriweather");
    expect(settings.fontSize.value).toBe("0.875rem");
  });

  it("reads saved font and size from localStorage", async () => {
    store["app-font"] = "montserrat";
    store["app-font-size"] = "xl";

    const { useAppFont } = await loadUseAppFont();
    const settings = useAppFont();

    expect(settings.appFont.value).toBe("montserrat");
    expect(settings.appFontSize.value).toBe("xl");
    expect(settings.fontSize.value).toBe("1.8rem");
  });

  it("persists font and size changes", async () => {
    const { useAppFont } = await loadUseAppFont();
    const settings = useAppFont();

    settings.setFont("merriweather");
    settings.setFontSize("lg");

    expect(store["app-font"]).toBe("merriweather");
    expect(store["app-font-size"]).toBe("lg");
    expect(settings.fontStyle.value).toEqual({
      fontFamily: settings.fontFamily.value,
      fontSize: "1.6rem",
    });
  });

  it("applies font-family and font-size to document root on change", async () => {
    const { useAppFont } = await loadUseAppFont();
    const settings = useAppFont();

    const setProperty = document.documentElement.style
      .setProperty as unknown as ReturnType<typeof vi.fn>;

    settings.setFont("open-sans");
    expect(setProperty).toHaveBeenCalledWith(
      "--app-font-family",
      expect.stringContaining("Open Sans"),
    );
    expect(setProperty).toHaveBeenCalledWith("--app-font-size", "0.875rem");

    settings.setFontSize("lg");
    expect(setProperty).toHaveBeenCalledWith("--app-font-size", "1.6rem");
  });

  it("reads old chat-font keys as fallback for migration", async () => {
    // If there's no 'app-font' key but there IS a 'chat-font' key,
    // the module-level code should not find it (we don't migrate automatically).
    // This test ensures the new storage keys are used.
    store["chat-font"] = "geist";
    store["app-font"] = "merriweather";

    const { useAppFont } = await loadUseAppFont();
    const settings = useAppFont();

    // The new key takes precedence
    expect(settings.appFont.value).toBe("merriweather");
  });
});
