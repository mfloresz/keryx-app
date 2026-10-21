import { ref, computed } from "vue";

const STORAGE_KEY = "app-font";
const STORAGE_KEY_SIZE = "app-font-size";

export type AppFont =
  | "geist"
  | "ibm-plex-mono"
  | "ibm-plex-sans"
  | "manrope"
  | "merriweather"
  | "montserrat"
  | "open-sans"
  | "sn-pro"
  | "spectral";
export type AppFontSize = "sm" | "md" | "lg" | "xl";

const fontMap: Record<AppFont, string> = {
  geist:
    "'Geist Variable', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "ibm-plex-mono":
    "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  "ibm-plex-sans":
    "'IBM Plex Sans Variable', ui-sans-serif, system-ui, sans-serif",
  manrope: "'Manrope Variable', ui-sans-serif, system-ui, sans-serif",
  merriweather:
    "'Merriweather Variable', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
  montserrat: "'Montserrat Variable', ui-sans-serif, system-ui, sans-serif",
  "open-sans": "'Open Sans Variable', ui-sans-serif, system-ui, sans-serif",
  "sn-pro": "'SN Pro Variable', ui-sans-serif, system-ui, sans-serif",
  spectral: "'Spectral', serif",
};

const fontSizeMap: Record<AppFontSize, string> = {
  sm: "0.875rem",
  md: "1.25rem",
  lg: "1.6rem",
  xl: "1.8rem",
};

function isAppFont(value: string | null): value is AppFont {
  return value !== null && Object.prototype.hasOwnProperty.call(fontMap, value);
}

function isAppFontSize(value: string | null): value is AppFontSize {
  return (
    value !== null && Object.prototype.hasOwnProperty.call(fontSizeMap, value)
  );
}

function applyFontToRoot(family: string, size: string) {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--app-font-family", family);
    document.documentElement.style.setProperty("--app-font-size", size);
  }
}

const savedFont = localStorage.getItem(STORAGE_KEY);
const savedFontSize = localStorage.getItem(STORAGE_KEY_SIZE);

const appFont = ref<AppFont>(isAppFont(savedFont) ? savedFont : "merriweather");
const appFontSize = ref<AppFontSize>(
  isAppFontSize(savedFontSize) ? savedFontSize : "sm",
);

// Apply immediately on module load (before any component mounts)
applyFontToRoot(fontMap[appFont.value], fontSizeMap[appFontSize.value]);

export function useAppFont() {
  function setFont(font: AppFont) {
    appFont.value = font;
    localStorage.setItem(STORAGE_KEY, font);
    applyFontToRoot(fontMap[font], fontSizeMap[appFontSize.value]);
  }

  function setFontSize(size: AppFontSize) {
    appFontSize.value = size;
    localStorage.setItem(STORAGE_KEY_SIZE, size);
    applyFontToRoot(fontMap[appFont.value], fontSizeMap[size]);
  }

  const fontFamily = computed(() => fontMap[appFont.value]);
  const fontSize = computed(() => fontSizeMap[appFontSize.value]);

  const fontStyle = computed(() => ({
    fontFamily: fontFamily.value,
    fontSize: fontSize.value,
  }));

  return {
    appFont,
    appFontSize,
    setFont,
    setFontSize,
    fontFamily,
    fontSize,
    fontStyle,
  };
}
