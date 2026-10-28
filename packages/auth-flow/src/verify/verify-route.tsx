import { headers } from "next/headers";

import { withRuntimeBotProtection } from "../bot-protection/server";
import { readDoorInputs, type DoorSearchParams } from "../door-inputs";
import type { AuthFlowHostConfig } from "../host-config";
import { returnContextSlots } from "../login/return-context-card";
import { resolveRegistrationArrival } from "../register/registration-arrival";
import { AuthShell } from "../shell";
import { VerifyAddressGate, VerifyStep } from "./verify-entry";

/**
 * `<VerifyRoute>` — the ONE server mount of the confirmation step (#2027 PR
 * 1.7; ADR-0013 A1 cross-front reuse), the sibling of `RegisterRoute`. The
 * registration door renders its code step in place and settles the address on
 * `routes.verify` (003 EARS-24); this mount is what a reload or a new tab of
 * that address enters, so the step survives both. The host route file is a MOUNT naming
 * its own `AuthFlowHostConfig`; everything below is host-neutral.
 *
 * Server-side, before the first byte of HTML, it takes the SAME decision the
 * registration door took from the same arrival (`resolveRegistrationArrival`):
 * the #675 signed-in guard (a doctor who holds a session has nothing to confirm
 * here), the landing, the эфир intent the confirmation completes (021 EARS-10),
 * the rule S3 carry, and the return-context panel the canvas «Подтверждение»
 * draws on both hosts — «после подтверждения почты вы вернётесь сюда же».
 *
 * The address is handed to the client gate, which sends an arrival with none to
 * the registration door (003 EARS-40) by a client `replace`, the way every
 * other in-journey hop of this step navigates.
 */
export async function VerifyRoute({
  config: hostConfig,
  searchParams,
}: {
  config: AuthFlowHostConfig;
  searchParams: Promise<DoorSearchParams>;
}) {
  // #2981 — the site key is runtime env, read per request (bot-protection/server).
  const config = withRuntimeBotProtection(hostConfig);
  // #3345 — read only through the door-input contract (the first value of a
  // repeated param wins, the way the other auth mounts read theirs).
  const inputs = readDoorInputs("verify", await searchParams);
  const returnTo = inputs.returnTo ?? null;
  const email = inputs.email;

  const arrival = await resolveRegistrationArrival({
    config,
    returnTo: returnTo ?? undefined,
    requestHeaders: await headers(),
    pathname: config.routes.verify,
  });
  // The registration variant: its line is the confirmation's promise.
  const { panel, plate } = returnContextSlots({
    config,
    event: arrival.returnEvent,
    variant: "register",
  });

  return (
    // 003 EARS-40 — the gate wraps the whole frame: a bare `/verify` renders
    // no shell and no panel before the client replaces it onto `/register`.
    <VerifyAddressGate
      config={config}
      {...(email ? { email } : {})}
      returnTo={returnTo}
    >
      <AuthShell config={config} returnContext={panel}>
        <VerifyStep
          config={config}
          landing={arrival.landing}
          {...(arrival.resolveSignedInLanding
            ? { resolveSignedInLanding: arrival.resolveSignedInLanding }
            : {})}
          {...(arrival.resolveCompletionTarget
            ? { resolveCompletionTarget: arrival.resolveCompletionTarget }
            : {})}
          returnTarget={arrival.returnTarget}
          carriedTarget={arrival.carriedTarget}
          // The mobile plate above the card, as the registration door draws it.
          returnContextPlate={plate}
        />
      </AuthShell>
    </VerifyAddressGate>
  );
}
