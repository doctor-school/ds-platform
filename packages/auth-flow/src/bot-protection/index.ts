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
 * site key THIS app was built with and the copy its failures map onto.
 *
 * Why the key is a config VALUE and not read here: Next inlines `NEXT_PUBLIC_*`
 * only at a LITERAL `process.env.NEXT_PUBLIC_…` read in the app's own source, so
 * a package reading the variable — or worse, an env NAME handed to it — would
 * see `undefined` in every built host. Each host does its own literal read and
 * states the result; both hosts read the same
 * `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`. Unset (the dev-stand default) the block
 * resumes the protected action tokenless, exactly matching the api guard's no-op
 * when no provider is configured.
 */
export function botProtectionSiteKey(
  config: AuthFlowHostConfig,
): string | undefined {
  return config.botProtection.siteKey;
}

/** The four-state challenge copy the shared block's failure kinds resolve to. */
export function botProtectionMessages(
  config: AuthFlowHostConfig,
): BotProtectionMessages {
  return resolveAuthFlowCopy(config).botProtection;
}
