/*! coi-serviceworker v0.2.3 - Miika Ahdesmaki and contributors - MIT License */
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) =>
    event.waitUntil(self.clients.claim()),
  );

  self.addEventListener("fetch", (event) => {
    if (
      event.request.cache === "only-if-cached" &&
      event.request.mode !== "same-origin"
    ) {
      return;
    }

    const url = new URL(event.request.url);

    // Skip cross-origin requests that can't have COEP headers re-added
    if (url.origin !== self.location.origin) {
      return;
    }

    // Skip API requests to avoid interfering with streaming responses
    if (url.pathname.startsWith("/api/")) {
      return;
    }

    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.status === 0) {
          return response;
        }

        // If the server already provides COEP headers (e.g. Vercel in production),
        // return the response as-is to avoid reconstructing it, which can cause
        // "Failed to fetch" errors when the body stream is already consumed or
        // when credentialless policies interfere with the new Response.
        if (response.headers.get("Cross-Origin-Embedder-Policy")) {
          return response;
        }

        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy", "credentialless");
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }),
    );
  });
} else {
  (() => {
    const script = document.currentScript;
    if (script) {
      const src = script.getAttribute("src");
      if (src && !src.startsWith("http")) {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.register(src).then((registration) => {
            console.log("COI Service Worker registered", registration.scope);
            // Do NOT auto-reload on updatefound. Aggressive reloads during
            // active sessions can lose in-memory state (e.g., streaming AI responses).
            // The new service worker will activate on the next page visit.
            if (registration.active && !navigator.serviceWorker.controller) {
              // First-time installation: reload once to activate the service worker.
              location.reload();
            }
          });
        }
      }
    }
  })();
}
