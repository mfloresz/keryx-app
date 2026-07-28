const CLIENT_API_ROUTES = [/^\/api\/chats(\/.*)?$/];

function isClientApiRoute(url: string): boolean {
  try {
    const pathname = new URL(url, location.href).pathname;
    return CLIENT_API_ROUTES.some((re) => re.test(pathname));
  } catch {
    return false;
  }
}

export function enableClientApiInterceptor(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String(input);

    if (isClientApiRoute(url)) {
      try {
        const { apiFetch } = await import("@/utils/clientApi");
        const response = await apiFetch(input, init, originalFetch);
        if (response instanceof Response) {
          return response;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return new Response(JSON.stringify({ message }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return originalFetch(input, init);
  };
}
