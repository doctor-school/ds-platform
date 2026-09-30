import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import { returnContextSlots } from "../login/return-context-card";
import { RETURN_CONTEXT_PARAM } from "../server";
import { AuthShell } from "../shell";
import { RegisterDoor } from "./register-door";
import { resolveRegistrationArrival } from "./registration-arrival";

/**
 * `<RegisterRoute>` — the ONE server mount of the sign-up door, hosted by both
 * storefronts (#2027 PR 1.6; ADR-0013 A1 cross-front reuse).
 *
 * The sibling of `<LoginRoute>` and deliberately its twin: each host's
 * `app/.../register/page.tsx` is now a MOUNT that names its own
 * `AuthFlowHostConfig` and forwards `searchParams`, and everything below — the
 * arrival read, the landing decision, the signed-in guard, the return-context
 * slots and the frame — is host-NEUTRAL. Every difference between the two
 * storefronts is config DATA: the routes, the эфир path projection, whether its
 * landing is specialty-aware, the attribution line and the points promise.
 *
 * WHY A SERVER COMPONENT. Both per-visitor facts — «is this visitor already
 * signed in» (#675) and «where does sign-up lead» (021 EARS-3 / LD-4) — are
 * decided before the first byte of HTML, from ONE `headers()` read forwarded
 * through the shared resolvers. The Academy decided them in two places that
 * could not see each other: a server layout held the guard and a client page
 * held the door, so the guard could not honour the returnTo-aware landing the
 * door was about to publish. One mount now decides both, in order.
 *
 * `searchParams` stays the PROMISE it arrives as and is awaited HERE, so the
 * host route file keeps its single JSX mount with no await of its own.
 */
export async function RegisterRoute({
  config,
  searchParams,
}: {
  config: AuthFlowHostConfig;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — a malformed return context degrades to no context,
  // it never breaks the door.
  const returnTo = Array.isArray(raw) ? raw[0] : raw;

  // The #675 guard, the landing decision and the return-context read — the
  // same decision the `/verify` step takes from the same arrival.
  const { landing, returnEvent } = await resolveRegistrationArrival({
    config,
    returnTo,
    requestHeaders: await headers(),
    pathname: config.routes.register,
  });

  const { panel, plate } = returnContextSlots({
    config,
    event: returnEvent,
    variant: "register",
  });

  return (
    <AuthShell config={config} returnContext={panel}>
      <RegisterDoor
        config={config}
        landing={landing}
        // The RAW arrival value: the door's shared carry helper answers both the
        // эфир and the account shape and re-appends only what the guards
        // reconstructed, so a hostile param is dropped at the hop (#2258 / S3).
        returnTo={returnTo ?? null}
        returnContextPlate={plate}
      />
    </AuthShell>
  );
}
