import { getAuthContext } from "./supabaseAuth.js";
import { getUserById, type AppUserRecord } from "./appStore.js";

export async function requireUser(request: Request): Promise<AppUserRecord> {
  const auth = await getAuthContext(request);
  if (!auth?.userId) {
    throw new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const user = await getUserById(auth.userId);
  if (!user) {
    throw new Response(JSON.stringify({ message: "User profile not found" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  return user;
}

export async function requireAdmin(request: Request): Promise<AppUserRecord> {
  const user = await requireUser(request);
  if (user.role !== "admin") {
    throw new Response(JSON.stringify({ message: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return user;
}
