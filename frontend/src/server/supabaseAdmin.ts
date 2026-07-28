function getEnv(name: string): string {
  return process.env[name] || "";
}

interface SupabaseAdminUser {
  id: string;
  email: string;
  app_metadata?: {
    role?: string;
  };
  user_metadata?: {
    role?: string;
  };
}

function getSupabaseUrl(): string {
  return getEnv("SUPABASE_URL").replace(/\/$/, "");
}

function getServiceRoleKey(): string {
  return getEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getServiceRoleKey());
}

async function requestSupabase(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const baseUrl = getSupabaseUrl();
  const serviceRoleKey = getServiceRoleKey();
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment variables are not configured");
  }

  return await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function listSupabaseUsers(): Promise<SupabaseAdminUser[]> {
  const response = await requestSupabase("/auth/v1/admin/users", {
    method: "GET",
  });
  const payload = (await response.json().catch(() => null)) as {
    users?: SupabaseAdminUser[];
    msg?: string;
    message?: string;
  } | null;
  if (!response.ok) {
    const message =
      typeof payload?.msg === "string"
        ? payload.msg
        : typeof payload?.message === "string"
          ? payload.message
          : "Unable to list Supabase users";
    throw new Error(message);
  }

  return payload?.users ?? [];
}

export async function findSupabaseUserByEmail(
  email: string,
): Promise<SupabaseAdminUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await listSupabaseUsers();
  return (
    users.find(
      (user) => user.email?.trim().toLowerCase() === normalizedEmail,
    ) ?? null
  );
}

export async function createSupabaseUser(params: {
  email: string;
  password: string;
  role: "admin" | "user";
}) {
  const response = await requestSupabase("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      password: params.password,
      email_confirm: true,
      user_metadata: {
        role: params.role,
      },
      app_metadata: {
        role: params.role,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as Record<
    string,
    any
  > | null;
  if (!response.ok) {
    const message =
      typeof payload?.msg === "string"
        ? payload.msg
        : typeof payload?.message === "string"
          ? payload.message
          : "Unable to create Supabase user";
    throw new Error(message);
  }

  return payload as {
    id: string;
    email: string;
  };
}

export async function updateSupabaseUserRole(params: {
  userId: string;
  role: "admin" | "user";
}) {
  const response = await requestSupabase(
    `/auth/v1/admin/users/${params.userId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        user_metadata: {
          role: params.role,
        },
        app_metadata: {
          role: params.role,
        },
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as Record<
    string,
    any
  > | null;
  if (!response.ok) {
    const message =
      typeof payload?.msg === "string"
        ? payload.msg
        : typeof payload?.message === "string"
          ? payload.message
          : "Unable to update Supabase user";
    throw new Error(message);
  }

  return payload;
}
