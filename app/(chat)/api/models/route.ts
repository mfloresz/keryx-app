import { connection } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getCapabilities,
  getDefaultModelForProvider,
  getModelsForProvider,
} from "@/lib/ai/models";
import { getAiSettings } from "@/lib/db/queries";

export async function GET() {
  await connection();

  const headers = {
    "Cache-Control": "private, max-age=300, s-maxage=300",
  };

  const [session, settings] = await Promise.all([auth(), getAiSettings()]);
  const providerModels = await getModelsForProvider(settings.activeProvider);
  const visibleModels =
    session?.user?.role === "admin"
      ? providerModels
      : providerModels.filter((model) =>
          settings.userAllowedModelIds.includes(model.id),
        );
  const defaultModelId =
    (await getDefaultModelForProvider(settings.activeProvider)) ??
    visibleModels[0]?.id;
  const capabilities = await getCapabilities(
    settings.activeProvider,
    visibleModels,
  );

  return Response.json(
    {
      capabilities,
      models: visibleModels,
      defaultModelId,
      activeProvider: settings.activeProvider,
    },
    { headers },
  );
}
