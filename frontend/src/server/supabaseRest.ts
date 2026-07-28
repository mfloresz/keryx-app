function getEnv(name: string): string {
  return process.env[name] || "";
}

function getSupabaseUrl(): string {
  return getEnv("SUPABASE_URL").replace(/\/$/, "");
}

function getServiceRoleKey(): string {
  return getEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function assertConfigured(): void {
  if (!getSupabaseUrl() || !getServiceRoleKey()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for cloud mode");
  }
}

function buildUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(`${getSupabaseUrl()}/rest/v1/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function request(
  path: string,
  init?: RequestInit,
  query?: Record<string, string>,
): Promise<Response> {
  assertConfigured();

  return await fetch(buildUrl(path, query), {
    ...init,
    headers: {
      apikey: getServiceRoleKey(),
      Authorization: `Bearer ${getServiceRoleKey()}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function selectRows<T>(
  table: string,
  query: Record<string, string>,
): Promise<T[]> {
  const response = await request(table, { method: "GET" }, query);
  if (!response.ok) {
    throw new Error(`Supabase select failed for ${table}: ${response.status}`);
  }
  return await readJson<T[]>(response);
}

export async function insertRows<T>(
  table: string,
  payload: Record<string, any> | Array<Record<string, any>>,
  options?: { upsert?: boolean; onConflict?: string },
): Promise<T[]> {
  const headers: Record<string, string> = {
    Prefer: options?.upsert
      ? "return=representation,resolution=merge-duplicates"
      : "return=representation",
  };
  if (options?.onConflict) {
    headers["on_conflict"] = options.onConflict;
  }

  const response = await request(
    table,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    options?.onConflict ? { on_conflict: options.onConflict } : undefined,
  );
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Supabase insert failed for ${table}: ${response.status} ${payload}`);
  }
  return await readJson<T[]>(response);
}

export async function updateRows<T>(
  table: string,
  filters: Record<string, string>,
  payload: Record<string, any>,
): Promise<T[]> {
  const response = await request(
    table,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
    filters,
  );
  if (!response.ok) {
    const payloadText = await response.text();
    throw new Error(`Supabase update failed for ${table}: ${response.status} ${payloadText}`);
  }
  return await readJson<T[]>(response);
}

export async function deleteRows(
  table: string,
  filters: Record<string, string>,
): Promise<void> {
  const response = await request(
    table,
    {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    },
    filters,
  );
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Supabase delete failed for ${table}: ${response.status} ${payload}`);
  }
}
