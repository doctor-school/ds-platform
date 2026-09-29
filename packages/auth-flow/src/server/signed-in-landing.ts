import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import { resolveArrivalLanding } from "./landing";

/**
 * #2333 - 021 EARS-3 / LD-4 decided again ONCE THE SESSION EXISTS.
 *
 * A door's `landing` is resolved at GUEST render, when the only remembered
 * specialty the server can read is the guest-cookie one. The doctor who keeps
 * their specialty on the PROFILE is only visible after sign-in, so the door asks
 * again then - through this server action, which runs the SAME package rule
 * (`resolveArrivalLanding`) over the action request's own headers, now carrying
 * the session cookie the sign-in just set. No rule is restated on the client.
 *
 * WHY A CLOSURE. The action is built by the server mount and closes over the
 * host's `landing` config; Next encrypts and signs closed-over values, so the
 * browser can invoke the action but cannot re-point the endpoints it reads. The
 * browser supplies no argument at all.
 *
 * `undefined` on a host whose landing is not specialty-aware: its landing is a
 * constant, and a round trip would re-derive the value the door already holds.
 */
export function signedInLandingAction(
  host: Pick<AuthFlowHostConfig, "landing">,
): (() => Promise<string>) | undefined {
  const { landing } = host;
  if (!landing.specialtyAware) return undefined;
  return async function resolveSignedInLanding(): Promise<string> {
    "use server";
    return resolveArrivalLanding({ landing }, await headers());
  };
}
