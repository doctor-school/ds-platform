import type { AuthFlowHostConfig } from "../host-config";

/**
 * The runtime env variable both storefronts read the PUBLIC SmartCaptcha site
 * key from (#2981). The SERVER half is the api's `SMARTCAPTCHA_SERVER_KEY`.
 */
export const SMARTCAPTCHA_SITE_KEY_ENV = "SMARTCAPTCHA_SITE_KEY";

/**
 * The host config the auth doors are handed, with the site key read from the
 * server's RUNTIME env at request time (#2981).
 *
 * One image serves every environment (stage and prod run the same digest), so no
 * build may bake a per-environment value: the key is not a `NEXT_PUBLIC_*`
 * inline but an ordinary server env read by the four server mounts, which hand
 * it to their client doors as serialised props. Unset or blank — the local
 * dev-stand default — yields no key, so `<BotProtectionField>` renders its
 * inactive placeholder and the protected action resumes tokenless, matching the
 * api guard's no-op when no provider is configured.
 */
export function withRuntimeBotProtection(
  config: AuthFlowHostConfig,
  env: NodeJS.ProcessEnv = process.env,
): AuthFlowHostConfig {
  const siteKey = env[SMARTCAPTCHA_SITE_KEY_ENV]?.trim() || undefined;
  return { ...config, botProtection: { siteKey } };
}
