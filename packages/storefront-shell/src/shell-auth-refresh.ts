"use client";

import { useEffect, useRef, useState } from "react";

import type { ShellAuthState } from "./config";

/**
 * The CLIENT half of the shell auth cluster - the re-read signal and the
 * subscription behind it (#1004, moved here by #2027 PR 1.4, wave-1 gate
 * S4.3:322).
 *
 * The cluster LOOK has been package-owned since #2180; the signal that refreshes
 * it was still a host module (`apps/portal/lib/header-auth.ts`), which is
 * exactly the seam where the two storefronts post-login behaviour could drift.
 * It belongs to the same contract as the slot it refreshes.
 *
 * The header lives in the root layout, which does not remount across client
 * navigations, so the read runs once on mount and again whenever
 * {@link refreshShellAuth} is signalled - the auth flows fire it right after a
 * successful login so the cluster swaps without a hard reload.
 *
 * The division of ownership is deliberate. The PACKAGE owns the subscription,
 * the latest-read-wins ordering, the no-flash re-read and the unmount guard -
 * the parts that are a mechanism. The HOST owns the `read` itself: the Academy
 * derives its initials from the self-profile (`GET /v1/me/profile`, the one
 * shipped surface that returns both the authenticated signal and the display
 * name), the doctor storefront has no display-name read in its header at all,
 * and each knows its own guest copy. That is why a rejected read keeps the last
 * state here instead of degrading to a guest cluster the package would have to
 * invent labels for; the host read is where a 401 becomes ITS guest state.
 */

/** Mounted {@link useShellAuth} subscribers awaiting a re-read signal. */
const listeners = new Set<() => void>();

/**
 * #1004 - signal every mounted {@link useShellAuth} to re-read its auth state.
 *
 * Called by the auth flows immediately after the auth state changes (login,
 * verify auto-login, reset auto-login, account logout), right before their soft
 * navigation, so the persistent header swaps guest-cluster and signed-in-cluster
 * without a hard reload. A no-op when no header is mounted.
 */
export function refreshShellAuth(): void {
  for (const listener of listeners) listener();
}

/**
 * Subscribe the mounted cluster to `read`, and to every {@link refreshShellAuth}
 * signal.
 *
 * Opens on `{ status: "loading" }` so the header can reserve the affordance box:
 * no layout shift and no first-paint flash of the wrong branch. A signalled
 * re-read KEEPS the current state rather than resetting to `loading`, so the
 * cluster never blinks on a refresh that resolves to the same thing.
 *
 * `read` is held in a ref rather than made a dependency of the effect: a host
 * that passes an inline closure would otherwise re-subscribe on every render,
 * which is a re-read storm rather than a refresh. The ref is kept current, so
 * the subscription is stable AND the read called is always the latest one -
 * never a stale closure over last render props.
 */
export function useShellAuth(
  read: () => Promise<ShellAuthState>,
): ShellAuthState {
  const [state, setState] = useState<ShellAuthState>({ status: "loading" });
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    let active = true;
    let latest = 0;

    const run = () => {
      // `latest` makes the most recently STARTED read win - a slow stale
      // response never overwrites a fresher one - and `active` bars setState
      // after unmount.
      const seq = ++latest;
      void (async () => {
        try {
          const next = await readRef.current();
          if (!active || seq !== latest) return;
          setState(next);
        } catch {
          // The host read owns its own degrade (it is the only side that knows
          // this host guest copy). Keeping the last cluster is the package part
          // of the same promise: a flaky read never takes the chrome down.
        }
      })();
    };

    run();
    listeners.add(run);
    return () => {
      active = false;
      listeners.delete(run);
    };
  }, []);

  return state;
}
