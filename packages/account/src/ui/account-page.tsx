import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolveServerAuth, withReturnContext } from "@ds/auth-flow/server";

import type { AccountHostConfig } from "../host-config";
import { AccountCabinet } from "./account-cabinet";
import { accountCabinetProps } from "./account-cabinet-props";

export interface AccountPageProps {
  /** The mounting storefront's data-only account config (gate D1). */
  config: AccountHostConfig;
}

/**
 * 003 EARS-28 / 014 EARS-6 — the account cabinet route mount (wave-4 gate row 1).
 *
 * THE GUEST DECISION IS TAKEN ON THE SERVER, before the first byte — rule S1 of
 * the auth-flow standard (`packages/auth-flow/README.md`): a visitor who may not
 * see the cabinet never sees a frame of it. ONE session read, the shared one
 * (`resolveServerAuth`), and the guest bounce carries the host's account route
 * as its return target through the shared `withReturnContext` (gate D3), so
 * signing in brings the doctor back to the cabinet they asked for.
 *
 * Everything the browser genuinely owns stays in {@link AccountCabinet}: the
 * EARS-27 self-read, the inline display-name write, the EARS-9 silent refresh
 * and sign-out. The server decision can be a moment stale — a session that
 * expires while the cabinet is open still bounces from there, same target.
 *
 * A host route file renders this with its host config and nothing else, keeps
 * its own `metadata`, and declares `dynamic = "force-dynamic"` itself: the
 * answer is per-visitor and a static prerender would serve one doctor's verdict
 * to everyone.
 */
export async function AccountPage({ config }: AccountPageProps) {
  const auth = await resolveServerAuth(await headers());
  if (auth.status !== "doctor") {
    const { login, account } = config.authFlow.routes;
    redirect(withReturnContext(config.authFlow, login, account));
  }

  return <AccountCabinet {...accountCabinetProps(config)} />;
}
