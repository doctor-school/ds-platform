"use client";

import { StorefrontHeader } from "@ds/storefront-shell";
import type { ShellAuthState, StorefrontShellConfig } from "@ds/storefront-shell";

import { useHeaderAuth } from "@/lib/header-auth";
import { LOGIN_HREF, PROFILE_HREF } from "@/lib/shell-config";

/**
 * 008 EARS-4/5/6 — the academy host's session read, and nothing else.
 *
 * This host resolves the sign-in state on the CLIENT ({@link useHeaderAuth} →
 * the shipped self-profile read), so the read needs a client boundary. It is
 * drawn as tightly as possible around that one fact: the config — every string,
 * link and dimension of the chrome — is still resolved on the SERVER, in
 * `academy-shell-header.tsx`, and arrives here as plain serializable data; this
 * leaf adds only the `auth` value.
 *
 * Since #2180 the chip itself is NOT assembled here. The host names the copy and
 * the destinations; `@ds/storefront-shell` owns the look, which is what stopped
 * this storefront's chip (194×44) drifting from the doctor storefront's
 * (191×48). `initials` is always passed — `null` included, for a doctor with no
 * saved display name (#997) — which is what selects the initials chip over the
 * doctor host's labelled one.
 */
export function AcademyShellHeaderClient({
  config,
  loginLabel,
  profileLabel,
}: {
  config: StorefrontShellConfig;
  /** «Войти / Регистрация» — the ONE guest control (canvas line 220). */
  loginLabel: string;
  /** The accessible name of the initials chip (catalog `shell.profile`). */
  profileLabel: string;
}) {
  const auth = useHeaderAuth();

  const state: ShellAuthState =
    auth.status === "loading"
      ? { status: "loading" }
      : auth.status === "guest"
        ? { status: "guest", loginHref: LOGIN_HREF, label: loginLabel }
        : {
            status: "doctor",
            profileHref: PROFILE_HREF,
            label: profileLabel,
            initials: auth.initials,
          };

  return <StorefrontHeader config={config} auth={state} />;
}
