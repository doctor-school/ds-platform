import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthFlowHostConfig } from "@ds/auth-flow/host-config";
import { resolveServerAuth, withReturnContext } from "@ds/auth-flow/server";

import { CongressSection, type CongressSectionHost } from "../ui";

/** The host half of the section's route: where it is mounted and linked. */
export interface CongressSectionRouteHost extends Omit<
  CongressSectionHost,
  "signInHref"
> {
  /** The path the section is mounted at — the sign-in door's return target. */
  path: string;
}

/**
 * 046 EARS-4 — the server mount of «Мои заявки на Конгресс». A guest is decided
 * on the SERVER and sent to the host's existing login carrying the section path
 * as the return target (the account-family shape `@ds/auth-flow` already
 * admits), so the emailed-code sign-in lands them back here with no change to
 * the login or registration. A signed-in account gets the section, whose own
 * read sends a session that ends while the page is open to the same door.
 *
 * The host route file renders this with its two host configs and nothing else.
 */
export async function CongressSectionRoute({
  auth,
  host,
}: {
  auth: Pick<AuthFlowHostConfig, "routes">;
  host: CongressSectionRouteHost;
}) {
  const { path, ...links } = host;
  const signInHref = withReturnContext(auth, auth.routes.login, path);
  const session = await resolveServerAuth(await headers());
  if (session.status === "guest") redirect(signInHref);

  return <CongressSection host={{ ...links, signInHref }} />;
}
