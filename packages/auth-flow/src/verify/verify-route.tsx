import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "../host-config";
import { returnContextSlots } from "../login/return-context-card";
import {
  RETURN_CONTEXT_PARAM,
  guardAuthRoute,
  resolveArrivalLanding,
  resolveReturnContext,
  resolveReturnTargetPath,
  resolveServerAuth,
} from "../server";
import { AuthShell } from "../shell";
import { VerifyEntry } from "./verify-entry";

/**
 * `<VerifyRoute>` — the ONE server mount of the confirmation step for a host
 * that serves `routes.verify` (#2027 PR 1.7; ADR-0013 A1 cross-front reuse), the
 * sibling of `RegisterRoute`. The host route file is a MOUNT naming its own
 * `AuthFlowHostConfig`; everything below is host-neutral.
 *
 * Server-side, before the first byte of HTML: the #675 signed-in guard (a doctor
 * who holds a session has nothing to confirm here), the LD landing, and the
 * return-context panel on a host that publishes one — «после подтверждения
 * почты вы вернётесь сюда же» (canvas 469-472). The address and the carried
 * target are handed to the client half, which alone can read the mail's
 * `#email=` fragment.
 *
 * A host whose `routes.verify` is `undefined` confirms inline on the
 * registration door (rows 51, 76); mounting this route there is a wiring
 * mistake and fails loudly instead of guarding a path the host does not serve.
 */
export async function VerifyRoute({
  config,
  searchParams,
}: {
  config: AuthFlowHostConfig;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const verifyPath = config.routes.verify;
  if (!verifyPath) {
    throw new Error(
      "auth-flow: this host confirms inline and serves no /verify",
    );
  }
  const params = await searchParams;
  // A repeated param arrives as an array; the FIRST value wins, the way the
  // other auth mounts read theirs.
  const returnTo = firstOf(params[RETURN_CONTEXT_PARAM]) ?? null;
  const email = firstOf(params.email);
  const requestHeaders = await headers();

  // #675 — the same guard the retired `app/verify/layout.tsx` ran, now inside
  // the mount (the retirement `/login` and `/register` had before it).
  const auth = await resolveServerAuth(requestHeaders);
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: verifyPath,
    routes: config.routes,
  });

  const landing = await resolveArrivalLanding(config, requestHeaders);
  // 021 EARS-3 — the эфир read fills the card, so a host with none never pays.
  const safeTarget = resolveReturnTargetPath(returnTo ?? undefined);
  const returnEvent =
    config.returnTo?.card && safeTarget
      ? await resolveReturnContext(safeTarget)
      : null;
  // The registration variant: its line is the confirmation's promise.
  const { panel } = returnContextSlots({
    config,
    event: returnEvent,
    variant: "register",
  });

  return (
    <AuthShell config={config} returnContext={panel}>
      <VerifyEntry
        config={config}
        {...(email ? { email } : {})}
        landing={landing}
        returnTo={returnTo}
      />
    </AuthShell>
  );
}

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
