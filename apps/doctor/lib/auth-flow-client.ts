import { createAuthClient } from "@ds/auth-flow/client";

import { DOCTOR_AUTH_FLOW_API } from "./auth-flow.host-config";

/**
 * The doctor storefront's bound auth transport (#2027 PR 1.5).
 *
 * A module of its own rather than part of `lib/auth-flow.host-config.ts`: the
 * host config is DATA a server route file hands to the package, and a bound
 * client is behaviour, not a value the config may carry. Every doctor auth
 * screen calls this one.
 */
export const authClient = createAuthClient(DOCTOR_AUTH_FLOW_API);
