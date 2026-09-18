import type { MyProfile } from "@ds/schemas";
import type { ShellAuthState } from "@ds/storefront-shell";
import {
  forwardedHeaders,
  forwardedSessionFrom,
  resolveServerAuth,
  serverApiBase,
} from "@ds/auth-flow/server";

import { initialsFromDisplayName } from "@/lib/display-name";
import { LOGIN_HREF, MY_EVENTS_HREF, PROFILE_HREF } from "@/lib/shell-config";

/**
 * 008 EARS-4/5/6 — the academy header's sign-in branch, resolved on the SERVER
 * from the incoming request (#2281, epic #2020 / #2027).
 *
 * The same shape the doctor storefront has used since 017 EARS-1
 * (`apps/doctor/app/(storefront)/layout.tsx`): `@ds/auth-flow/server` decides
 * guest-vs-doctor — its one guest short-circuit (no session cookie, no upstream
 * read) and its one degrade rule (401 or a failed read is a guest) — and this
 * host projects the result onto the shared chrome's `auth` DATA prop. Because
 * the branch is decided before the first byte of HTML, the header never shows a
 * transitional state, and a login, logout or profile edit is reflected by the
 * next server render (`router.push/replace` or `router.refresh()`) rather than
 * by a client re-read signal.
 *
 * The one honest host difference is the chip: the Academy draws an INITIALS
 * square, and the session claims (`sub, roles, mfa`) carry no display name. So a
 * signed-in doctor costs one more server read — the self-profile
 * (`GET /v1/me/profile`, 003 design §12), the same surface the header read
 * client-side before, presented with the same fingerprint-bound header set
 * (`forwardedHeaders`) the session read uses. That read follows the shared
 * degrade rule too: a 401 or a failed read is a guest cluster, never a page
 * taken down by the chrome.
 *
 * `initials` is always set — `null` included, for a doctor with no saved
 * display name (#997) — which is what selects the initials chip over the doctor
 * host's labelled one. `fetchImpl` is injected by tests only.
 */

/** The catalog-resolved copy of the two clusters (`shell` namespace). */
export interface AcademyShellAuthLabels {
  /** «Войти / Регистрация» — the ONE guest control (canvas line 220). */
  login: string;
  /** The accessible name of the initials chip. */
  profile: string;
  /** «Мои события» — the cluster's link beside the chip (canvas `user.links`). */
  myEvents: string;
}

export async function resolveAcademyShellAuth(
  requestHeaders: Headers,
  labels: AcademyShellAuthLabels,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellAuthState> {
  const guest: ShellAuthState = {
    status: "guest",
    loginHref: LOGIN_HREF,
    label: labels.login,
  };

  const auth = await resolveServerAuth(requestHeaders, fetchImpl);
  if (auth.status === "guest") return guest;

  const profile = await readProfile(requestHeaders, fetchImpl);
  if (profile === null) return guest;

  return {
    status: "doctor",
    profileHref: PROFILE_HREF,
    label: labels.profile,
    initials: profile.displayName
      ? initialsFromDisplayName(profile.displayName)
      : null,
    // Canvas `user.links` line 209 — the academy cluster's «Мои события» beside
    // the avatar. The package decides where it is drawn at each width; the host
    // names only the copy and the destination (#2243).
    links: [{ label: labels.myEvents, href: MY_EVENTS_HREF }],
  };
}

/** The self-profile on the doctor's behalf; `null` for a 401 or any failure. */
async function readProfile(
  requestHeaders: Headers,
  fetchImpl: typeof fetch,
): Promise<MyProfile | null> {
  try {
    const res = await fetchImpl(`${serverApiBase()}/v1/me/profile`, {
      headers: forwardedHeaders(forwardedSessionFrom(requestHeaders)),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as MyProfile;
  } catch {
    return null;
  }
}
