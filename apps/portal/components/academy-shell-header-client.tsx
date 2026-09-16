"use client";

import { StorefrontHeader, useShellAuth } from "@ds/storefront-shell";
import type { ShellAuthState, StorefrontShellConfig } from "@ds/storefront-shell";

import { initialsFromDisplayName } from "@/lib/display-name";
import { getMyProfile } from "@/lib/profile-client";
import { LOGIN_HREF, PROFILE_HREF } from "@/lib/shell-config";

/**
 * 008 EARS-4/5/6 — the academy host's session READ, and nothing else.
 *
 * This host resolves the sign-in state on the CLIENT, so the read needs a client
 * boundary. It is drawn as tightly as possible around that one fact: the config
 * — every string, link and dimension of the chrome — is still resolved on the
 * SERVER, in `academy-shell-header.tsx`, and arrives here as plain serializable
 * data; this leaf adds only the `auth` value.
 *
 * Since #2180 the chip itself is NOT assembled here, and since #2027 PR 1.4 the
 * SUBSCRIPTION is not either: `useShellAuth` (`@ds/storefront-shell`) owns the
 * re-read signal, the latest-read-wins ordering, the no-flash refresh and the
 * unmount guard, so the two storefronts cannot drift on when the cluster
 * refreshes. What stays here is the part that is genuinely this host's: WHICH
 * read answers the question, and what this host's guest and signed-in clusters
 * say.
 *
 * Source note (008 design §3): the design names `GET /v1/auth/session` as the
 * AuthState source, but that endpoint returns only `{ sub, roles, mfa }` — no
 * display name, so it cannot yield the EARS-5 avatar initials. The self-profile
 * read is the single shipped surface returning BOTH the authenticated signal
 * (200 vs 401) and the display name. No new endpoint either way.
 *
 * `initials` is always passed — `null` included, for a doctor with no saved
 * display name (#997) — which is what selects the initials chip over the doctor
 * host's labelled one.
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
  const auth = useShellAuth(async (): Promise<ShellAuthState> => {
    const guest: ShellAuthState = {
      status: "guest",
      loginHref: LOGIN_HREF,
      label: loginLabel,
    };
    try {
      const profile = await getMyProfile();
      if (profile === null) return guest;
      return {
        status: "doctor",
        profileHref: PROFILE_HREF,
        label: profileLabel,
        initials: profile.displayName
          ? initialsFromDisplayName(profile.displayName)
          : null,
      };
    } catch {
      // A non-401 transient error degrades to the guest affordance — this host's
      // own rule, and the reason the package leaves the degrade to the read: the
      // worst case is a guest control the doctor can still use to get back in,
      // never a shell taken down over a flaky profile read.
      return guest;
    }
  });

  return <StorefrontHeader config={config} auth={auth} />;
}
