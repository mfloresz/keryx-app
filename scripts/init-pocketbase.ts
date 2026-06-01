import { config } from "dotenv";

config({ path: ".env.local" });
config();

type PocketBaseCollection = {
  id: string;
  name: string;
  type: string;
};

type AuthResponse = {
  token: string;
};

const baseUrl = process.env.POCKETBASE_URL?.replace(/\/$/, "");
const superuserEmail = process.env.POCKETBASE_SUPERUSER_EMAIL;
const superuserPassword = process.env.POCKETBASE_SUPERUSER_PASSWORD;
const initialAdminEmail = process.env.POCKETBASE_INITIAL_APP_ADMIN_EMAIL;
const initialAdminPassword = process.env.POCKETBASE_INITIAL_APP_ADMIN_PASSWORD;

if (!baseUrl || !superuserEmail || !superuserPassword) {
  console.error(
    "Missing POCKETBASE_URL, POCKETBASE_SUPERUSER_EMAIL or POCKETBASE_SUPERUSER_PASSWORD",
  );
  process.exit(1);
}

async function pbRequest<T>(
  path: string,
  init?: RequestInit,
  token?: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

async function loginSuperuser() {
  const response = await pbRequest<AuthResponse>(
    "/api/collections/_superusers/auth-with-password",
    {
      method: "POST",
      body: JSON.stringify({
        identity: superuserEmail,
        password: superuserPassword,
      }),
    },
  );

  return response.token;
}

async function listCollections(token: string) {
  const result = await pbRequest<
    { items?: PocketBaseCollection[] } | PocketBaseCollection[]
  >("/api/collections?perPage=200&page=1", undefined, token);

  return Array.isArray(result) ? result : (result.items ?? []);
}

async function upsertCollection(
  token: string,
  definition: Record<string, unknown>,
) {
  const collections = await listCollections(token);
  const existing = collections.find((item) => item.name === definition.name);

  if (existing) {
    await pbRequest(
      `/api/collections/${existing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify(definition),
      },
      token,
    );
    console.log(`updated collection ${definition.name}`);
    return existing.id;
  }

  const created = await pbRequest<PocketBaseCollection>(
    "/api/collections",
    {
      method: "POST",
      body: JSON.stringify(definition),
    },
    token,
  );

  console.log(`created collection ${definition.name}`);
  return created.id;
}

function textField(name: string, required = false, unique = false) {
  return {
    name,
    type: "text",
    required,
    unique,
    min: 0,
    max: 0,
    pattern: "",
    autogeneratePattern: "",
  };
}

function jsonField(name: string, required = false) {
  return {
    name,
    type: "json",
    required,
    maxSize: 0,
  };
}

function boolField(name: string, required = false) {
  return {
    name,
    type: "bool",
    required,
  };
}

function dateField(name: string, required = false) {
  return {
    name,
    type: "date",
    required,
    min: "",
    max: "",
  };
}

function selectField(name: string, values: string[], required = false) {
  return {
    name,
    type: "select",
    required,
    maxSelect: 1,
    values,
  };
}

function autodateField(name: string, onUpdate: boolean) {
  return {
    name,
    type: "autodate",
    onCreate: true,
    onUpdate,
  };
}

const baseTimestampFields = [
  autodateField("created", false),
  autodateField("updated", true),
];

const timestampedBaseCollections = [
  "chats",
  "messages",
  "documents",
  "suggestions",
  "streams",
  "invites",
  "app_settings",
] as const;

async function ensureCollections(token: string) {
  const lockedRules = {
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };

  await upsertCollection(token, {
    ...lockedRules,
    name: "users",
    type: "auth",
    fields: [
      selectField("role", ["admin", "user"], true),
      selectField("status", ["active", "disabled"], true),
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "chats",
    type: "base",
    fields: [
      textField("chat_id", true, true),
      textField("title", true),
      textField("user", true),
      selectField("visibility", ["public", "private"], true),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_chats_chat_id ON chats (chat_id)",
      "CREATE INDEX idx_chats_user ON chats (user)",
      "CREATE INDEX idx_chats_visibility ON chats (visibility)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "messages",
    type: "base",
    fields: [
      textField("message_id", true, true),
      textField("chat", true),
      textField("user", true),
      textField("role", true),
      jsonField("parts", true),
      jsonField("attachments", false),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_messages_message_id ON messages (message_id)",
      "CREATE INDEX idx_messages_chat ON messages (chat)",
      "CREATE INDEX idx_messages_user ON messages (user)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "votes",
    type: "base",
    fields: [
      textField("chat_id", true),
      textField("message_id", true),
      boolField("is_upvoted", true),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_votes_chat_message ON votes (chat_id, message_id)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "documents",
    type: "base",
    fields: [
      textField("document_id", true),
      textField("title", true),
      textField("kind", true),
      textField("user", true),
      textField("content", false),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE INDEX idx_documents_document_id ON documents (document_id)",
      "CREATE INDEX idx_documents_user ON documents (user)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "suggestions",
    type: "base",
    fields: [
      textField("suggestion_id", true, true),
      textField("document_id", true),
      dateField("document_created_at", true),
      textField("original_text", true),
      textField("suggested_text", true),
      textField("description", false),
      boolField("is_resolved", true),
      textField("user", true),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_suggestions_suggestion_id ON suggestions (suggestion_id)",
      "CREATE INDEX idx_suggestions_document_id ON suggestions (document_id)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "streams",
    type: "base",
    fields: [
      textField("stream_id", true, true),
      textField("chat_id", true),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_streams_stream_id ON streams (stream_id)",
      "CREATE INDEX idx_streams_chat_id ON streams (chat_id)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "invites",
    type: "base",
    fields: [
      textField("email", true),
      selectField("role", ["admin", "user"], true),
      textField("token_hash", true, true),
      dateField("expires_at", true),
      dateField("used_at", false),
      textField("created_by", true),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_invites_token_hash ON invites (token_hash)",
      "CREATE INDEX idx_invites_email ON invites (email)",
    ],
  });

  await upsertCollection(token, {
    ...lockedRules,
    name: "app_settings",
    type: "base",
    fields: [
      textField("slug", true, true),
      selectField("active_provider", ["vercel_gateway", "opencode_go"], true),
      jsonField("user_allowed_models", true),
      ...baseTimestampFields,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_app_settings_slug ON app_settings (slug)",
    ],
  });
}

async function repairBaseCollectionTimestamps(token: string) {
  const now = new Date().toISOString();

  for (const collection of timestampedBaseCollections) {
    const result = await pbRequest<{
      items: Array<{
        id: string;
        created?: string | null;
        updated?: string | null;
      }>;
    }>(
      `/api/collections/${collection}/records?perPage=200&page=1`,
      undefined,
      token,
    );

    let repairedCount = 0;

    for (const record of result.items) {
      const patch: Record<string, string> = {};

      if (!record.created) {
        patch.created = now;
      }

      if (!record.updated) {
        patch.updated = patch.created ?? now;
      }

      if (Object.keys(patch).length === 0) {
        continue;
      }

      await pbRequest(
        `/api/collections/${collection}/records/${record.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
        token,
      );

      repairedCount += 1;
    }

    if (repairedCount > 0) {
      console.log(
        `repaired ${repairedCount} timestamped record(s) in ${collection}`,
      );
    }
  }
}

async function ensureGlobalSettings(token: string) {
  const settings = await pbRequest<{ items: Array<{ id: string }> }>(
    "/api/collections/app_settings/records?filter=slug%20%3D%20%22global%22&perPage=1&page=1",
    undefined,
    token,
  );

  if (settings.items.length > 0) {
    return;
  }

  await pbRequest(
    "/api/collections/app_settings/records",
    {
      method: "POST",
      body: JSON.stringify({
        slug: "global",
        active_provider: "vercel_gateway",
        user_allowed_models: [
          "deepseek/deepseek-v3.2",
          "moonshotai/kimi-k2.5",
          "openai/gpt-oss-20b",
          "openai/gpt-oss-120b",
          "xai/grok-4.1-fast-non-reasoning",
        ],
      }),
    },
    token,
  );

  console.log("created global app_settings record");
}

async function ensureInitialAppAdmin(token: string) {
  if (!initialAdminEmail || !initialAdminPassword) {
    console.log(
      "Skipping app admin bootstrap. Set POCKETBASE_INITIAL_APP_ADMIN_EMAIL and POCKETBASE_INITIAL_APP_ADMIN_PASSWORD to create one.",
    );
    return;
  }

  const existing = await pbRequest<{ items: Array<{ id: string }> }>(
    `/api/collections/users/records?filter=email%20%3D%20%22${encodeURIComponent(initialAdminEmail)}%22&perPage=1&page=1`,
    undefined,
    token,
  );

  if (existing.items.length > 0) {
    console.log(`app admin ${initialAdminEmail} already exists`);
    return;
  }

  await pbRequest(
    "/api/collections/users/records",
    {
      method: "POST",
      body: JSON.stringify({
        email: initialAdminEmail,
        password: initialAdminPassword,
        passwordConfirm: initialAdminPassword,
        role: "admin",
        status: "active",
        emailVisibility: false,
        verified: true,
      }),
    },
    token,
  );

  console.log(`created initial app admin ${initialAdminEmail}`);
}

async function main() {
  const token = await loginSuperuser();
  await ensureCollections(token);
  await repairBaseCollectionTimestamps(token);
  await ensureGlobalSettings(token);
  await ensureInitialAppAdmin(token);
  console.log("PocketBase initialization complete");
}

main().catch((error) => {
  console.error("PocketBase initialization failed:");
  console.error(error);
  process.exit(1);
});
