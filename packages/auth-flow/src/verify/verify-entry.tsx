"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import type { AuthFlowHostConfig } from "../host-config";
import { withReturnTarget } from "../return-target-href";
import { VerifyDoor } from "./verify-door";

/** The resolved address, handed from the gate to the step inside the shell. */
const VerifyAddressContext = createContext<string | null>(null);

/**
 * The client gate of `VerifyRoute` — where the confirmation surface learns
 * WHICH address it confirms (003 EARS-24, #904).
 *
 * The same-tab hop from the registration door carries `?email=`, read by the
 * server mount. The `/verify#email=<addr>` deep link carries the address in the
 * URL FRAGMENT, which the browser never sends to the server, so a cold open is
 * seeded here, after mount, and only on a host that serves deep-link entry
 * (`verify.deepLinkEntry`). The query wins when both are present.
 *
 * 003 EARS-40 (#2394) — with neither there is nothing to confirm: the visitor
 * is REPLACED onto the registration door, carrying a same-origin `returnTo`
 * onward. Only the browser can see the fragment, so the decision is taken
 * here, once the fragment has been read. The gate wraps the WHOLE route frame
 * (the shell and its return-context panel included), and renders nothing until
 * an address is known — a bare `/verify` paints no page before it leaves.
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
    <VerifyAddressContext.Provider value={address}>
      {children}
    </VerifyAddressContext.Provider>
  );
}

/**
 * The confirmation step inside the gate's frame: the `VerifyDoor` over the
 * address the gate resolved. Outside a gate it renders nothing — there is no
 * address-less step (003 EARS-40).
 */
export function VerifyStep({
  config,
  landing,
  returnTo,
  returnContextPlate,
}: {
  config: AuthFlowHostConfig;
  landing: string;
  /** The RAW arrival `returnTo`; guarded at every consumption point. */
  returnTo: string | null;
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
      // The Academy's 003 verify command takes no target: the carried value is
      // COMPLETED after sign-in (005 EARS-2 — on a cold open the parked one,
      // 014 EARS-6) and carried by the sideways hops (rule S3).
      completionTarget={returnTo}
      carriedTarget={returnTo}
      returnContextPlate={returnContextPlate}
    />
  );
}

/** The gate and the step with no frame between them — the step on its own. */
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
  returnTo: string | null;
  returnContextPlate?: ReactNode;
}) {
  return (
    <VerifyAddressGate config={config} email={email} returnTo={returnTo}>
      <VerifyStep
        config={config}
        landing={landing}
        returnTo={returnTo}
        returnContextPlate={returnContextPlate}
      />
    </VerifyAddressGate>
  );
}

/** The `#email=<addr>` fragment, or `undefined` when it carries none. */
function fragmentAddress(): string | undefined {
  const hash = window.location.hash;
  if (!hash.startsWith("#")) return undefined;
  return new URLSearchParams(hash.slice(1)).get("email") || undefined;
}
