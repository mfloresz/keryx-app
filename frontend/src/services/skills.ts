import { getAuthAdapter } from "#/services/runtime";

export interface SkillInfo {
  name: string;
  description: string;
}

/** Lists the skills the admin has enabled (GET /api/skills). */
export async function listSkills(): Promise<SkillInfo[]> {
  const auth = await getAuthAdapter();
  const res = await fetch("/api/skills", {
    headers: await auth.getAuthorizationHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to load skills: ${res.status}`);
  }
  return (await res.json()) as SkillInfo[];
}
