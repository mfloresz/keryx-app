import { IS_STATIC_MODE } from "./config";

export async function bootstrapApp(): Promise<void> {
  if (!IS_STATIC_MODE) {
    return;
  }

  try {
    const [{ initOpfsWorker }, { enableClientApiInterceptor }] =
      await Promise.all([
        import("@/utils/opfsWorkerClient"),
        import("@/adapters/static/clientApiInterceptor"),
      ]);

    initOpfsWorker();
    enableClientApiInterceptor();
  } catch (error) {
    console.error("Failed to initialize static runtime:", error);
  }
}
