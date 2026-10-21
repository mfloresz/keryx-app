import * as React from "react";

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

const FONT_KEY = "app-font";
const FONT_SIZE_KEY = "app-font-size";

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

export const appFonts: Array<{ value: AppFont; label: string }> = [
  { value: "geist", label: "Geist" },
  { value: "ibm-plex-mono", label: "IBM Plex Mono" },
  { value: "ibm-plex-sans", label: "IBM Plex Sans" },
  { value: "manrope", label: "Manrope" },
  { value: "merriweather", label: "Merriweather" },
  { value: "montserrat", label: "Montserrat" },
  { value: "open-sans", label: "Open Sans" },
  { value: "sn-pro", label: "SN Pro" },
  { value: "spectral", label: "Spectral" },
];

export const appFontSizes: Array<{ value: AppFontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Extra Large" },
];

function isAppFont(value: string | null): value is AppFont {
  return value !== null && Object.prototype.hasOwnProperty.call(fontMap, value);
}

function isAppFontSize(value: string | null): value is AppFontSize {
  return (
    value !== null && Object.prototype.hasOwnProperty.call(fontSizeMap, value)
  );
}

/** Writes the chosen font onto the document root as a CSS variable. */
export function applyAppFont(font: AppFont, size: AppFontSize) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--app-font-family", fontMap[font]);
  root.style.setProperty("--app-font-size", fontSizeMap[size]);
}

interface AppFontContextValue {
  appFont: AppFont;
  appFontSize: AppFontSize;
  setFont: (font: AppFont) => void;
  setFontSize: (size: AppFontSize) => void;
}

const AppFontContext = React.createContext<AppFontContextValue | null>(null);

export function AppFontProvider({ children }: { children: React.ReactNode }) {
  const [appFont, setAppFontState] = React.useState<AppFont>(() => {
    const stored = localStorage.getItem(FONT_KEY);
    return isAppFont(stored) ? stored : "merriweather";
  });
  const [appFontSize, setAppFontSizeState] = React.useState<AppFontSize>(() => {
    const stored = localStorage.getItem(FONT_SIZE_KEY);
    return isAppFontSize(stored) ? stored : "sm";
  });

  React.useEffect(() => {
    applyAppFont(appFont, appFontSize);
  }, [appFont, appFontSize]);

  const setFont = React.useCallback((font: AppFont) => {
    setAppFontState(font);
    localStorage.setItem(FONT_KEY, font);
  }, []);

  const setFontSize = React.useCallback((size: AppFontSize) => {
    setAppFontSizeState(size);
    localStorage.setItem(FONT_SIZE_KEY, size);
  }, []);

  const value = React.useMemo(
    () => ({ appFont, appFontSize, setFont, setFontSize }),
    [appFont, appFontSize, setFont, setFontSize],
  );

  return (
    <AppFontContext.Provider value={value}>{children}</AppFontContext.Provider>
  );
}

export function useAppFont(): AppFontContextValue {
  const context = React.useContext(AppFontContext);
  if (!context) {
    throw new Error("useAppFont must be used inside an AppFontProvider");
  }
  return context;
}
