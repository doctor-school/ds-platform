import { liveStandGate } from "@ds/e2e/live-stand-env";

/** The 006 room live-stand env gate bound to this host's storefront variable — the gate and its env-set docblock live once in `@ds/e2e/live-stand-env`. */
export const { requireLiveStandEnv, requireShortHeartbeat } = liveStandGate({
  urlVar: "E2E_PORTAL_URL",
  playwrightTimeout: "the 120 s Playwright timeout",
});
