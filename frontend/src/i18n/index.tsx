/**
 * Minimal i18n layer for the React app.
 *
 * Replaces vue-i18n with a small context + hook. Messages are flat-ish
 * JSON objects keyed by dot path (same files as the Vue app), so the
 * translation content carries over unchanged.
 */
import * as React from "react";

import en from "#/locales/en.json";
import es from "#/locales/es.json";
import {
  applyLocaleToDocument,
  resolveInitialLocale,
  STORAGE_KEY,
  type Locale,
} from "#/i18n/locale";

type Messages = Record<string, unknown>;

const MESSAGES: Record<Locale, Messages> = { en, es } as unknown as Record<
  Locale,
  Messages
>;

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

function lookup(messages: Messages, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
  return typeof value === "string" ? value : undefined;
}

export function createTranslator(locale: Locale): Translate {
  const primary = MESSAGES[locale] ?? MESSAGES.en;
  const fallback = MESSAGES.en;

  return (key, params) => {
    const template = lookup(primary, key) ?? lookup(fallback, key);
    if (template === undefined) return key;
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}

interface I18nContextValue {
  locale: Locale;
  t: Translate;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    const initial = resolveInitialLocale();
    applyLocaleToDocument(initial);
    return initial;
  });

  const t = React.useMemo(() => createTranslator(locale), [locale]);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    applyLocaleToDocument(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleLocale = React.useCallback(() => {
    setLocale(locale === "en" ? "es" : "en");
  }, [locale, setLocale]);

  const value = React.useMemo(
    () => ({ locale, t, setLocale, toggleLocale }),
    [locale, t, setLocale, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = React.useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside an I18nProvider");
  }
  return context;
}

export { STORAGE_KEY } from "#/i18n/locale";
export type { Locale } from "#/i18n/locale";
