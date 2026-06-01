"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/app/(auth)/auth";
import {
  createInvite,
  deleteUserByIdAdmin,
  setUserStatusById,
  updateAiSettings,
  type AIProvider,
} from "@/lib/db/queries";
import {
  getDefaultModelForProvider,
  getModelsForProvider,
} from "@/lib/ai/models";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "user"]),
  expiresInDays: z.coerce.number().int().min(1).max(30),
});

const settingsSchema = z.object({
  activeProvider: z.enum(["vercel_gateway", "opencode_go"]),
  allowedModels: z.array(z.string()).optional(),
});

function getAdminRedirect(params?: Record<string, string>) {
  const url = new URL("/admin", "http://local");

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return `${url.pathname}${url.search}`;
}

export async function createInviteAction(formData: FormData) {
  const session = await requireRole("admin");

  const data = inviteSchema.parse({
    email: formData.get("email"),
    role: formData.get("role"),
    expiresInDays: formData.get("expiresInDays"),
  });

  const expiresAt = new Date(
    Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const { token } = await createInvite({
    email: data.email,
    role: data.role,
    expiresAt,
    createdBy: session.user.id,
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const invitePath = `${basePath}/invite/${token}`;
  const inviteUrl = appUrl
    ? `${appUrl}${invitePath}?email=${encodeURIComponent(data.email)}`
    : `${invitePath}?email=${encodeURIComponent(data.email)}`;

  redirect(
    getAdminRedirect({
      message: "invite_created",
      invite: inviteUrl,
    })
  );
}

export async function updateAiSettingsAction(formData: FormData) {
  await requireRole("admin");

  const parsed = settingsSchema.parse({
    activeProvider: formData.get("activeProvider"),
    allowedModels: formData.getAll("allowedModels"),
  });

  const provider = parsed.activeProvider as AIProvider;
  const providerModels = await getModelsForProvider(provider);
  const providerModelIds = new Set(providerModels.map((model) => model.id));
  const filteredAllowedModels = (parsed.allowedModels ?? []).filter((modelId) =>
    providerModelIds.has(modelId)
  );
  const fallbackModel = await getDefaultModelForProvider(provider);

  await updateAiSettings({
    activeProvider: provider,
    userAllowedModelIds:
      filteredAllowedModels.length > 0
        ? filteredAllowedModels
        : fallbackModel
          ? [fallbackModel]
          : [],
  });

  redirect(getAdminRedirect({ message: "settings_updated" }));
}

export async function disableUserAction(formData: FormData) {
  const session = await requireRole("admin");
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "disabled");

  if (userId && userId !== session.user.id) {
    await setUserStatusById({
      userId,
      status: status === "active" ? "active" : "disabled",
    });
  }

  redirect(getAdminRedirect({ message: "user_updated" }));
}

export async function deleteUserAction(formData: FormData) {
  const session = await requireRole("admin");
  const userId = String(formData.get("userId") ?? "");

  if (userId && userId !== session.user.id) {
    await deleteUserByIdAdmin({ userId });
  }

  redirect(getAdminRedirect({ message: "user_deleted" }));
}
