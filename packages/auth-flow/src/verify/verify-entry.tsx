"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import type { AuthFlowHostConfig } from "../host-config";
import { withReturnTarget } from "../return-target-href";
import { VerifyDoor } from "./verify-door";

/**
 * The client half of `VerifyRoute` — where the confirmation surface learns
 * WHICH address it confirms (003 EARS-24, #904).
 *
 * The same-tab hop from the registration door carries `?email=`, read by the
 * server mount. The verification MAIL's button opens `/verify#email=<addr>`
 * instead: the address rides the URL FRAGMENT, which the browser never sends to
 * the server (the #869 scanner-prefetch invariant), so a cold open is seeded
 * here, after mount, and only on a host whose mail links in
 * (`verify.deepLinkEntry`). The query wins when both are present.
 *
 * 003 EARS-40 (#2394) — with neither there is nothing to confirm: the visitor
 * is REPLACED onto the registration door, carrying a same-origin `returnTo`
 * onward. Only the browser can see the fragment, so this decision is taken
 * here, once the seed is read; until then the step renders nothing, so no
 * address-less card is ever painted.
 */
export function VerifyEntry({
  config,
  email,
  landing,
  returnTo,
  returnContextPlate,
}: {
  config: AuthFlowHostConfig;
  email?: string | undefined;
  landing: string;
  /** The RAW arrival `returnTo`; guarded at every consumption point. */
  returnTo: string | null;
  /** 021 EARS-2 — the mobile plate the server mount resolved; passed through. */
  returnContextPlate?: ReactNode;
}) {
  const router = useRouter();
  const deepLinkEntry = config.verify.deepLinkEntry;
  const registerPath = config.routes.register;
  const [fragmentEmail, setFragmentEmail] = useState<string | undefined>();
  useEffect(() => {
    if (email) return;
    const seeded = deepLinkEntry ? fragmentAddress() : undefined;
    if (seeded) {
      setFragmentEmail(seeded);
      return;
    }
    // `replace`: an address-less `/verify` must not sit behind a back gesture.
    router.replace(withReturnTarget(registerPath, returnTo));
  }, [email, deepLinkEntry, registerPath, returnTo, router]);

  const address = email ?? fragmentEmail;
  if (!address) return null;

  return (
    <VerifyDoor
      config={config}
      email={address}
      landing={landing}
      // The Academy's 003 verify command takes no target: the carried value is
      // COMPLETED after sign-in (005 EARS-2 — on a cold open the parked one,
      // 014 EARS-6) and carried by the sideways hops (rule S3).
      completionTarget={returnTo}
      carriedTarget={returnTo}
      returnContextPlate={returnContextPlate}
    />
  );
}

/** The mail's `#email=<addr>` fragment, or `undefined` when it carries none. */
function fragmentAddress(): string | undefined {
  const hash = window.location.hash;
  if (!hash.startsWith("#")) return undefined;
  return new URLSearchParams(hash.slice(1)).get("email") || undefined;
}
