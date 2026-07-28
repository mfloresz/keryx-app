export type DeployMode = "static" | "cloud";

function readEnvFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "string") {
    return value === "true";
  }
  return fallback;
}

const rawDeployMode = import.meta.env.VITE_DEPLOY_MODE;

if (rawDeployMode && rawDeployMode !== "static" && rawDeployMode !== "cloud") {
  throw new Error(`Invalid VITE_DEPLOY_MODE: ${rawDeployMode}`);
}

export const DEPLOY_MODE: DeployMode =
  rawDeployMode === "cloud" ? "cloud" : "static";
export const IS_STATIC_MODE = DEPLOY_MODE === "static";
export const IS_CLOUD_MODE = DEPLOY_MODE === "cloud";

export const APP_NAME = import.meta.env.VITE_APP_NAME || "Keryx";

export const ENABLE_AUTH = IS_CLOUD_MODE
  ? readEnvFlag(import.meta.env.VITE_ENABLE_AUTH, false)
  : false;

export const ENABLE_LOCAL_KEYS = IS_STATIC_MODE
  ? true
  : readEnvFlag(import.meta.env.VITE_ENABLE_LOCAL_KEYS, true);

export const ENABLE_OPFS = IS_STATIC_MODE
  ? true
  : readEnvFlag(import.meta.env.VITE_ENABLE_OPFS, true);

export const ENABLE_ADMIN = IS_CLOUD_MODE
  ? readEnvFlag(import.meta.env.VITE_ENABLE_ADMIN, false)
  : false;
