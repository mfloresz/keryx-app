import {
  OPENCODE_MODELS,
  VERCEL_MODELS,
  type ProviderValue,
} from "../shared/utils/models.js";
import {
  deleteRows,
  insertRows,
  selectRows,
  updateRows,
} from "./supabaseRest.js";

export interface AppUserRecord {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  updatedAt: string;
}

export interface AppInvitationRecord {
  id: string;
  email: string;
  tokenHash: string;
  role: "admin" | "user";
  expiresAt: string;
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
  initialModelAccess: string[];
}

export interface AppModelRecord {
  id: string;
  provider: ProviderValue;
  displayName: string;
  supportsImages: boolean;
  supportsSearch: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AppUserRow {
  id: string;
  email: string;
  role: "admin" | "user";
  created_at: string;
  updated_at: string;
}

interface InvitationRow {
  id: string;
  email: string;
  token_hash: string;
  role: "admin" | "user";
  expires_at: string;
  used_at: string | null;
  created_by: string;
  created_at: string;
  initial_model_access: string[] | null;
}

interface ModelRow {
  id: string;
  provider: ProviderValue;
  display_name: string;
  supports_images: boolean;
  supports_search: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface UserModelAccessRow {
  user_id: string;
  model_id: string;
  created_at: string;
}

const USERS_TABLE = "keryx_app_users";
const INVITATIONS_TABLE = "keryx_invitations";
const MODELS_TABLE = "keryx_models";
const USER_MODEL_ACCESS_TABLE = "keryx_user_model_access";

function getCatalogModels(): AppModelRecord[] {
  const now = new Date().toISOString();
  return [
    ...VERCEL_MODELS.map((model) => ({
      id: model.value,
      provider: "vercel" as const,
      displayName: model.label,
      supportsImages: model.supportsImages,
      supportsSearch: model.supportsSearch,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })),
    ...OPENCODE_MODELS.map((model) => ({
      id: model.value,
      provider: "opencode" as const,
      displayName: model.label,
      supportsImages: model.supportsImages,
      supportsSearch: model.supportsSearch,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })),
  ];
}

function mapUser(row: AppUserRow): AppUserRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInvitation(row: InvitationRow): AppInvitationRecord {
  return {
    id: row.id,
    email: row.email,
    tokenHash: row.token_hash,
    role: row.role,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    initialModelAccess: row.initial_model_access ?? [],
  };
}

function mapModel(row: ModelRow): AppModelRecord {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    supportsImages: Boolean(row.supports_images),
    supportsSearch: Boolean(row.supports_search),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasCatalogMetadataChanged(
  existing: ModelRow,
  next: AppModelRecord,
): boolean {
  return (
    existing.provider !== next.provider ||
    existing.display_name !== next.displayName ||
    existing.supports_images !== next.supportsImages ||
    existing.supports_search !== next.supportsSearch
  );
}

async function syncModelCatalog(): Promise<void> {
  const existingRows = await selectRows<ModelRow>(MODELS_TABLE, {
    select:
      "id,provider,display_name,supports_images,supports_search,enabled,created_at,updated_at",
  });

  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const catalogModels = getCatalogModels();
  const catalogIds = new Set(catalogModels.map((model) => model.id));
  const now = new Date().toISOString();

  const rowsToUpsert: ModelRow[] = [];

  for (const model of catalogModels) {
    const existing = existingById.get(model.id);
    if (!existing) {
      rowsToUpsert.push({
        id: model.id,
        provider: model.provider,
        display_name: model.displayName,
        supports_images: model.supportsImages,
        supports_search: model.supportsSearch,
        enabled: model.enabled,
        created_at: model.createdAt,
        updated_at: model.updatedAt,
      });
      continue;
    }

    if (!hasCatalogMetadataChanged(existing, model)) {
      continue;
    }

    rowsToUpsert.push({
      id: model.id,
      provider: model.provider,
      display_name: model.displayName,
      supports_images: model.supportsImages,
      supports_search: model.supportsSearch,
      enabled: existing.enabled,
      created_at: existing.created_at,
      updated_at: now,
    });
  }

  if (rowsToUpsert.length > 0) {
    await insertRows<ModelRow>(MODELS_TABLE, rowsToUpsert, {
      upsert: true,
      onConflict: "id",
    });
  }

  for (const row of existingRows) {
    if (!catalogIds.has(row.id)) {
      await deleteRows(MODELS_TABLE, { id: `eq.${row.id}` });
    }
  }
}

export async function countUsers(): Promise<number> {
  const rows = await selectRows<AppUserRow>(USERS_TABLE, {
    select: "id",
  });
  return rows.length;
}

export async function listUsers(): Promise<AppUserRecord[]> {
  const rows = await selectRows<AppUserRow>(USERS_TABLE, {
    select: "id,email,role,created_at,updated_at",
    order: "created_at.asc",
  });
  return rows.map(mapUser);
}

export async function countAdmins(): Promise<number> {
  const rows = await selectRows<AppUserRow>(USERS_TABLE, {
    select: "id",
    role: "eq.admin",
  });
  return rows.length;
}

export async function getUserById(
  userId: string,
): Promise<AppUserRecord | null> {
  const rows = await selectRows<AppUserRow>(USERS_TABLE, {
    select: "id,email,role,created_at,updated_at",
    id: `eq.${userId}`,
    limit: "1",
  });
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserByEmail(
  email: string,
): Promise<AppUserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await selectRows<AppUserRow>(USERS_TABLE, {
    select: "id,email,role,created_at,updated_at",
    email: `eq.${normalizedEmail}`,
    limit: "1",
  });
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function upsertUser(user: AppUserRecord): Promise<void> {
  await insertRows<AppUserRow>(
    USERS_TABLE,
    {
      id: user.id,
      email: user.email.toLowerCase(),
      role: user.role,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    },
    { upsert: true, onConflict: "id" },
  );
}

export async function updateUserRole(
  userId: string,
  role: AppUserRecord["role"],
): Promise<void> {
  await updateRows<AppUserRow>(
    USERS_TABLE,
    { id: `eq.${userId}` },
    {
      role,
      updated_at: new Date().toISOString(),
    },
  );
}

export async function listModels(): Promise<AppModelRecord[]> {
  await syncModelCatalog();
  const rows = await selectRows<ModelRow>(MODELS_TABLE, {
    select:
      "id,provider,display_name,supports_images,supports_search,enabled,created_at,updated_at",
    order: "provider.asc,display_name.asc",
  });
  return rows.map(mapModel);
}

export async function setModelEnabled(
  modelId: string,
  enabled: boolean,
): Promise<void> {
  await updateRows<ModelRow>(
    MODELS_TABLE,
    { id: `eq.${modelId}` },
    {
      enabled,
      updated_at: new Date().toISOString(),
    },
  );
}

export async function getUserModelAccess(userId: string): Promise<string[]> {
  const rows = await selectRows<UserModelAccessRow>(USER_MODEL_ACCESS_TABLE, {
    select: "model_id",
    user_id: `eq.${userId}`,
    order: "model_id.asc",
  });
  return rows.map((row) => row.model_id);
}

export async function setUserModelAccess(
  userId: string,
  modelIds: string[],
): Promise<void> {
  await deleteRows(USER_MODEL_ACCESS_TABLE, {
    user_id: `eq.${userId}`,
  });

  const uniqueModelIds = [...new Set(modelIds)];
  if (uniqueModelIds.length === 0) {
    return;
  }

  const createdAt = new Date().toISOString();
  await insertRows<UserModelAccessRow>(
    USER_MODEL_ACCESS_TABLE,
    uniqueModelIds.map((modelId) => ({
      user_id: userId,
      model_id: modelId,
      created_at: createdAt,
    })),
  );
}

export async function getAllowedModelsForUser(
  userId: string,
): Promise<AppModelRecord[]> {
  const user = await getUserById(userId);
  if (!user) {
    return [];
  }

  const models = await listModels();
  if (user.role === "admin") {
    return models;
  }

  return models.filter((model) => model.enabled);
}

export async function listInvitations(): Promise<AppInvitationRecord[]> {
  const rows = await selectRows<InvitationRow>(INVITATIONS_TABLE, {
    select:
      "id,email,token_hash,role,expires_at,used_at,created_by,created_at,initial_model_access",
    order: "created_at.desc",
  });
  return rows.map(mapInvitation);
}

export async function createInvitation(
  invitation: AppInvitationRecord,
): Promise<void> {
  await insertRows<InvitationRow>(INVITATIONS_TABLE, {
    id: invitation.id,
    email: invitation.email.toLowerCase(),
    token_hash: invitation.tokenHash,
    role: invitation.role,
    expires_at: invitation.expiresAt,
    used_at: invitation.usedAt,
    created_by: invitation.createdBy,
    created_at: invitation.createdAt,
    initial_model_access: invitation.initialModelAccess,
  });
}

export async function getInvitationByTokenHash(
  tokenHash: string,
): Promise<AppInvitationRecord | null> {
  const rows = await selectRows<InvitationRow>(INVITATIONS_TABLE, {
    select:
      "id,email,token_hash,role,expires_at,used_at,created_by,created_at,initial_model_access",
    token_hash: `eq.${tokenHash}`,
    limit: "1",
  });
  return rows[0] ? mapInvitation(rows[0]) : null;
}

export async function markInvitationUsed(
  invitationId: string,
  usedAt: string,
): Promise<void> {
  await updateRows<InvitationRow>(
    INVITATIONS_TABLE,
    { id: `eq.${invitationId}` },
    { used_at: usedAt },
  );
}

export async function deleteInvitation(invitationId: string): Promise<void> {
  await deleteRows(INVITATIONS_TABLE, {
    id: `eq.${invitationId}`,
  });
}
