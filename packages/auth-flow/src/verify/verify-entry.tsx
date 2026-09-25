"use client";

import { useEffect, useState } from "react";

import type { AuthFlowHostConfig } from "../host-config";
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
 */
export function VerifyEntry({
  config,
  email,
  landing,
  returnTo,
}: {
  config: AuthFlowHostConfig;
  email?: string | undefined;
  landing: string;
  /** The RAW arrival `returnTo`; guarded at every consumption point. */
  returnTo: string | null;
}) {
  const deepLinkEntry = config.verify.deepLinkEntry;
  const [fragmentEmail, setFragmentEmail] = useState<string | undefined>();
  useEffect(() => {
    if (email || !deepLinkEntry) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#")) return;
    const seeded = new URLSearchParams(hash.slice(1)).get("email");
    if (seeded) setFragmentEmail(seeded);
  }, [email, deepLinkEntry]);

  return (
    <VerifyDoor
      config={config}
      email={email ?? fragmentEmail}
      landing={landing}
      // The Academy's 003 verify command takes no target: the carried value is
      // COMPLETED after sign-in (005 EARS-2 — on a cold open the parked one,
      // 014 EARS-6) and carried by the sideways hops (rule S3).
      completionTarget={returnTo}
      carriedTarget={returnTo}
    />
  );
}
