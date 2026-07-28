/**
 * Application Entry Point
 *
 * Bootstraps the Vue app with:
 * - Pinia for state management
 * - Vue Router for navigation
 * - Vue I18n for internationalization
 * - Fetch interception for client-side API handling
 */
import "./style.css";

import "@fontsource-variable/merriweather";
import "@fontsource/spectral";

import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import { useTheme } from "./composables/useTheme";
import { bootstrapApp } from "./app/bootstrap";

import App from "./App.vue";
import i18n from "./i18n";

// Initialize theme before app mount
useTheme();

async function mountApp(): Promise<void> {
  await bootstrapApp();

  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(router);
  app.use(i18n);

  router.onError((error) => {
    console.error("Router navigation failed:", error);
  });

  app.mount("#app");
}

void mountApp();
