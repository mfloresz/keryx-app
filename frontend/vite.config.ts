import path from "node:path";
import { Readable } from "node:stream";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { handleApiRequest } from "./src/server/chatApi";

function cloudApiPlugin() {
  return {
    name: "keryx-cloud-api",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        await handleCloudApiRequest(req, res, next);
      });
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        await handleCloudApiRequest(req, res, next);
      });
    },
  };
}

async function handleCloudApiRequest(
  req: any,
  res: any,
  next: any,
): Promise<void> {
  if (!req.url?.startsWith("/api/")) {
    next();
    return;
  }

  const origin = `http://${req.headers.host || "localhost"}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const requestInit: RequestInit = {
    method: req.method,
    headers: req.headers,
  };
  if (chunks.length > 0) {
    requestInit.body = Buffer.concat(chunks);
  }

  const request = new Request(new URL(req.url, origin), requestInit);
  const response = await handleApiRequest(request);
  if (!response) {
    next();
    return;
  }

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const stream = Readable.fromWeb(
    response.body as globalThis.ReadableStream<Uint8Array>,
  );
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    res.on("close", resolve);
    res.on("finish", resolve);
    stream.pipe(res);
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // loadEnv does NOT populate process.env, but server-side code reads from it.
  // Merge loaded vars so the cloud API middleware can access them at runtime.
  for (const key of Object.keys(env)) {
    if (!(key in process.env)) {
      process.env[key] = env[key];
    }
  }
  const isCloudMode = env.VITE_DEPLOY_MODE === "cloud";

  return {
    plugins: [vue(), tailwindcss(), ...(isCloudMode ? [cloudApiPlugin()] : [])],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/api/ai-gateway": {
          target: "https://ai-gateway.vercel.sh",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ai-gateway/, ""),
        },
        "/api/opencode": {
          target: "https://opencode.ai/zen",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/opencode/, ""),
        },
      },
    },
  };
});
