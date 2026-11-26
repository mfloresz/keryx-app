import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "#/app/app";
import "@localix-ai/flowdown/styles.css";
import "@localix-ai/flowdown/math.css";
import "#/styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
