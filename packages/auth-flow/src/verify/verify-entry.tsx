"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { AuthFlowHostConfig } from "../host-config";
import type { CompletionTarget } from "../client/signed-in-landing";
import { withReturnTarget } from "../return-target-href";
import { VerifyDoor } from "./verify-door";

/** The resolved address, handed from the gate to the step inside the shell. */
const VerifyAddressContext = createContext<string | null>(null);

/**
 * The client gate of `VerifyRoute` — where the confirmation surface learns
 * WHICH address it confirms (003 EARS-24): the `?email=` the registration door's
 * hop carries, read by the server mount.
 *
 * 003 EARS-40 (#2394) — with no address there is nothing to confirm: the
 * visitor is REPLACED onto the registration door, carrying a same-origin
 * `returnTo` onward. The gate wraps the WHOLE route frame (the shell and its
 * return-context panel included) and renders nothing without an address — a
 * bare `/verify` paints no page before it leaves.
 */
export function VerifyAddressGate({
  config,
  email,
  returnTo,
  children,
}: {
  config: AuthFlowHostConfig;
  email?: string | undefined;
  /** The RAW arrival `returnTo`; guarded by `withReturnTarget`. */
  returnTo: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const registerPath = config.routes.register;
  useEffect(() => {
    if (email) return;
    // `replace`: an address-less `/verify` must not sit behind a back gesture.
    router.replace(withReturnTarget(registerPath, returnTo));
  }, [email, registerPath, returnTo, router]);

  if (!email) return null;
  return (
    <VerifyAddressContext.Provider value={email}>
      {children}
    </VerifyAddressContext.Provider>
  );
}

/** The targets the server mount resolved from the arrival, passed through. */
type VerifyTargets = {
  /**
   * 021 EARS-10 — the эфир intent to complete after sign-up, in this host's
   * vocabulary, or `null` when the arrival resolved none.
   */
  returnTarget?: string | null;
  /** Rule S3 — what the sideways hops and the cold exit carry onward. */
  carriedTarget?: string | null;
  /** 021 EARS-10 (#2455) — the mount's completion-time re-check; passed through. */
  resolveCompletionTarget?: () => Promise<CompletionTarget>;
};

/**
 * The confirmation step inside the gate's frame: the `VerifyDoor` over the
 * address the gate resolved. Outside a gate it renders nothing — there is no
 * address-less step (003 EARS-40).
 */
export function VerifyStep({
  config,
  landing,
  resolveSignedInLanding,
  resolveCompletionTarget,
  returnTarget = null,
  carriedTarget = null,
  returnContextPlate,
}: VerifyTargets & {
  config: AuthFlowHostConfig;
  landing: string;
  /** #2333 — the mount's signed-in re-decision of `landing`; passed through. */
  resolveSignedInLanding?: () => Promise<string>;
  /** 021 EARS-2 — the mobile plate the server mount resolved; passed through. */
  returnContextPlate?: ReactNode;
}) {
  const address = useContext(VerifyAddressContext);
  if (!address) return null;
  return (
    <VerifyDoor
      config={config}
      email={address}
      landing={landing}
      {...(resolveSignedInLanding ? { resolveSignedInLanding } : {})}
      {...(resolveCompletionTarget ? { resolveCompletionTarget } : {})}
      returnTarget={returnTarget}
      carriedTarget={carriedTarget}
      returnContextPlate={returnContextPlate}
    />
  );
}

/** The gate and the step with no frame between them — the step on its own. */
export function VerifyEntry({
  config,
  email,
  landing,
  resolveSignedInLanding,
  resolveCompletionTarget,
  returnTo,
  returnTarget = null,
  carriedTarget = null,
  returnContextPlate,
}: VerifyTargets & {
  config: AuthFlowHostConfig;
  email?: string | undefined;
  landing: string;
  resolveSignedInLanding?: () => Promise<string>;
  /** The RAW arrival `returnTo`, for the bare-arrival hop to `/register`. */
  returnTo: string | null;
  returnContextPlate?: ReactNode;
}) {
  return (
    <VerifyAddressGate config={config} email={email} returnTo={returnTo}>
      <VerifyStep
        config={config}
        landing={landing}
        {...(resolveSignedInLanding ? { resolveSignedInLanding } : {})}
        {...(resolveCompletionTarget ? { resolveCompletionTarget } : {})}
        returnTarget={returnTarget}
        carriedTarget={carriedTarget}
        returnContextPlate={returnContextPlate}
      />
    </VerifyAddressGate>
  );
}
