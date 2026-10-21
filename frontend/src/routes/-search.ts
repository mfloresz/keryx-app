import { z } from "zod";

/**
 * Search params shared by the chat routes. Validated so the router can
 * type them; unknown values are dropped rather than erroring.
 */
export const chatSearchSchema = z.object({
  preset: z.string().optional(),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
});

export type ChatSearch = z.infer<typeof chatSearchSchema>;
