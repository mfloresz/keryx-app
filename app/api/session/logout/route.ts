import { clearSession } from "@/app/(auth)/auth";

export async function POST() {
  await clearSession();
  return Response.json({ ok: true });
}
