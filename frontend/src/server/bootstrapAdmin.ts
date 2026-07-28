import { countUsers, getUserByEmail, upsertUser } from "./appStore.js";
import {
  createSupabaseUser,
  findSupabaseUserByEmail,
  isSupabaseAdminConfigured,
} from "./supabaseAdmin.js";

let bootstrapPromise: Promise<void> | null = null;

function getEnv(name: string): string {
  return process.env[name] || "";
}

async function bootstrapAdmin(): Promise<void> {
  const email = getEnv("BOOTSTRAP_ADMIN_EMAIL").trim().toLowerCase();
  const password = getEnv("BOOTSTRAP_ADMIN_PASSWORD");
  if (!email || !password) {
    return;
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return;
  }

  const userCount = await countUsers();
  if (userCount > 0) {
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "BOOTSTRAP_ADMIN_EMAIL/PASSWORD require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const createdUser =
    (await findSupabaseUserByEmail(email)) ??
    (await createSupabaseUser({
      email,
      password,
      role: "admin",
    }));

  const now = new Date().toISOString();
  await upsertUser({
    id: createdUser.id,
    email,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });
}

export async function ensureBootstrapAdmin(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapAdmin()
      .catch((error) => {
        console.error("[bootstrap-admin] failed", error);
      })
      .finally(() => {
        bootstrapPromise = null;
      });
  }

  await bootstrapPromise;
}
