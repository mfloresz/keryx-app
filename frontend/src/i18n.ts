/**
 * i18n
 *
 * Standalone i18n instance for use outside of component setup context
 * (e.g., Pinia stores, utility modules).
 *
 * Import this module instead of calling useI18n() when you need to
 * access translations in non-component contexts.
 */
import { createI18n } from "vue-i18n";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  applyLocaleToDocument,
  resolveInitialLocale,
} from "@/composables/locale";

const initialLocale = resolveInitialLocale();
applyLocaleToDocument(initialLocale);

const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: "en",
  messages: {
    en,
    es,
  },
});

export default i18n;
