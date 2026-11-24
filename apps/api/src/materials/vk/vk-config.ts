import { loadEnv } from "../../config/env.schema.js";

/**
 * 048 slice 3 (ADR-0011 §2.2 channel #11, EARS-39, EARS-51) — the VK
 * connector's server-side configuration. `null` unless all three secrets are
 * set: the connector is off (the kill switch) — the Callback route answers
 * `404`, nothing calls VK and the source check reports «VK не подключён на
 * сервере». The secrets live only in this object; they are never logged,
 * returned or stored.
 */
export interface VkConfig {
  serviceKey: string;
  callbackSecret: string;
  confirmation: string;
}

/** DI token: the {@link VkConfig}, or `null` when the connector is off. */
export const VK_CONFIG = Symbol("VK_CONFIG");

export function vkConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): VkConfig | null {
  const parsed = loadEnv(env);
  const serviceKey = parsed.VK_SERVICE_KEY;
  const callbackSecret = parsed.VK_CALLBACK_SECRET;
  const confirmation = parsed.VK_CALLBACK_CONFIRMATION;
  return serviceKey && callbackSecret && confirmation
    ? { serviceKey, callbackSecret, confirmation }
    : null;
}
