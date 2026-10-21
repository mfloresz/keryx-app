import { handleApiRequest } from "../src/server/chatApi.js";

function getRequestUrl(request: any): string {
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers.host || "localhost";
  return `${protocol}://${host}${request.url}`;
}

function getRequestHeaders(request: any): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readRequestBody(request: any): Promise<string | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
}

async function toWebRequest(request: any): Promise<Request> {
  return new Request(getRequestUrl(request), {
    method: request.method,
    headers: getRequestHeaders(request),
    body: await readRequestBody(request),
  });
}

async function writeWebResponseBody(
  apiResponse: Response,
  response: any,
): Promise<void> {
  if (!apiResponse.body) {
    response.end();
    return;
  }

  const reader = apiResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!response.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => response.once("drain", resolve));
      }
    }
    response.end();
  } catch (error) {
    response.destroy(error);
  } finally {
    reader.releaseLock();
  }
}

export default async function handler(
  request: any,
  response: any,
): Promise<void> {
  try {
    const apiResponse =
      (await handleApiRequest(await toWebRequest(request))) ??
      new Response("Not Found", { status: 404 });

    response.statusCode = apiResponse.status;
    apiResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });
    await writeWebResponseBody(apiResponse, response);
  } catch (error) {
    console.error("[api] unhandled request failure", error);
    const message = error instanceof Error ? error.message : "Internal error";
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ message }));
  }
}
