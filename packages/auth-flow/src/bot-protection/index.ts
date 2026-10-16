import type { BotProtectionMessages } from "@ds/design-system/blocks";

import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";

/**
 * The auth-flow half of bot protection (#2027, gate rows 15, 17, 18, 19).
 *
 * The widget itself, the resume-one-action orchestration (`useBotProtectedAction`)
 * and the error predicates are ONE implementation in `@ds/design-system/blocks`
 * and STAY there — this unit owns only the auth composition around them, i.e.
 * reading out of the host config what a design-system package must not know: the
 * site key the server mount resolved for this request and the copy its failures
 * map onto.
 *
 * The key is never read here: this module runs in the client doors, and the key
 * is RUNTIME env (#2981 — one image serves every environment, so no build bakes
 * it). The server mounts read `SMARTCAPTCHA_SITE_KEY` per request through
 * `./server.ts` and hand the doors the resolved `config.botProtection`. Unset
 * (the dev-stand default) the block resumes the protected action tokenless,
 * exactly matching the api guard's no-op when no provider is configured.
 */
export function botProtectionSiteKey(
  config: AuthFlowHostConfig,
): string | undefined {
  return config.botProtection?.siteKey;
}

/** The four-state challenge copy the shared block's failure kinds resolve to. */
export function botProtectionMessages(
  config: AuthFlowHostConfig,
): BotProtectionMessages {
  return resolveAuthFlowCopy(config).botProtection;
}
