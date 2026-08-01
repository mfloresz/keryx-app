/**
 * Application Entry Point
 */
import "./style.css";

import "@fontsource-variable/merriweather";
import "@fontsource/spectral";

// KaTeX styles required by the Comark math plugin (@comark/vue/plugins/math)
import "katex/dist/katex.min.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import { useTheme } from "./composables/useTheme";

import App from "./App.vue";
import i18n from "./i18n";

useTheme();

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);

router.onError((error) => {
  console.error("Router navigation failed:", error);
});

app.mount("#app");
