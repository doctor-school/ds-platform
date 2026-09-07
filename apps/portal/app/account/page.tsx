"use client";

import { useCallback, useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import type { MyProfile } from "@ds/schemas";

import { authClient, AuthError } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { refreshHeaderAuth } from "@/lib/header-auth";
import { getMyProfile } from "@/lib/profile-client";
import { setDisplayName, DisplayNameError } from "@/lib/display-name-client";
import { initialsFromDisplayName } from "@/lib/display-name";

import { Container } from "@ds/design-system/container";
import { AccountProfileCard } from "@ds/design-system/account-profile-card";

/*
 * 003 EARS-28 (design §12; GH #770) — the Academy's /account profile surface.
 *
 * Since #1958 the composition itself is the SHARED `<AccountProfileCard>` block
 * (`@ds/design-system/blocks`), because `doctor.school` projects the very same
 * surface until feature 022 (#1791) replaces it with the full doctor cabinet
 * (AGENTS.md §6 cross-front reuse; registry row «Account profile surface»). The
 * canvas, the elements, the classes and every `data-testid` moved verbatim — this
 * page is now the Academy PROJECTION and owns only its app glue.
 *
 * What stayed here: the EARS-27 self-read (`GET /v1/me/profile` via
 * `lib/profile-client`) — the caller's OWN identity fields, never the session
 * claims: `sub`, the roles array and the raw `mfa` boolean NEVER reach this DOM
 * (requirements Invariants); the display-name write through the EXISTING
 * `PUT /v1/me/display-name` (006 EARS-14; no new write endpoint); the #175 error
 * mapping; the `next-intl` copy; and the Academy route table («Сменить пароль»
 * hands off to the existing /reset flow, EARS-11/12 — no in-page password form).
 *
 * Session behavior is unchanged (EARS-9): a 401 gets ONE silent refresh + retry
 * before redirecting to /login. Logout (EARS-10) revokes server-side then routes
 * to /login — same `data-testid="logout"` contract as before.
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; profile: MyProfile };

export default function AccountPage() {
  const router = useRouter();
  const t = useTranslations("account");
  const te = useTranslations("errors");
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    // EARS-9 dance, unchanged: one silent refresh + one retry before /login.
    let profile: MyProfile | null = null;
    try {
      profile = await getMyProfile();
      if (!profile) {
        try {
          await authClient.refresh();
          profile = await getMyProfile();
        } catch {
          // refresh 401 (no/expired/reused session) — fall through to redirect.
        }
      }
    } catch {
      setState({ kind: "error" });
      return;
    }
    if (profile) {
      setState({ kind: "ready", profile });
    } else {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLogout() {
    try {
      await authClient.logout();
    } finally {
      // Whether or not the revoke round-trip succeeded, the user intends to leave.
      // #1004: signal the persistent header to re-read the auth state so the
      // avatar flips back to the guest affordance on this soft navigation —
      // mirroring the login-side call sites.
      refreshHeaderAuth();
      router.replace("/login");
    }
  }

  async function onSaveDisplayName(displayName: string) {
    // The EXISTING 006 EARS-14 write — same SSOT validation server-side.
    await setDisplayName(displayName);
    // Functional update: the handler closure may be a render behind by the time
    // the write resolves — never overwrite with a stale profile.
    setState((prev) =>
      prev.kind === "ready"
        ? { kind: "ready", profile: { ...prev.profile, displayName } }
        : prev,
    );
  }

  function resolveSaveError(err: unknown) {
    // #175 actionable-errors rule: route the failure through the shared mapper
    // (429 → too-many-attempts, 5xx/network → unavailable; the validation/auth
    // outcome stays the per-action generic). The display-name client throws its
    // own typed error — re-express it as `AuthError` so the mapper reads the status.
    const mapped =
      err instanceof DisplayNameError
        ? new AuthError(err.status, err.message)
        : err;
    return authErrorMessage(mapped, te, t("nameError"));
  }

  if (state.kind === "loading") {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <Container className="py-16">
          <p className="text-sm text-muted-foreground" role="status">
            {t("loading")}
          </p>
        </Container>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <Container className="py-16">
          <p className="text-sm text-muted-foreground" role="alert">
            {t("error")}
          </p>
        </Container>
      </main>
    );
  }

  const { profile } = state;

  return (
    <AccountProfileCard
      profile={profile}
      initials={
        profile.displayName
          ? initialsFromDisplayName(profile.displayName)
          : null
      }
      passwordHref="/reset"
      eventsHref="/account/events"
      renderLink={({ href, children }) => (
        <NextLink href={href}>{children}</NextLink>
      )}
      onSaveDisplayName={onSaveDisplayName}
      resolveSaveError={resolveSaveError}
      onSignOut={onLogout}
      copy={{
        title: t("title"),
        subtitle: t("subtitle"),
        sections: {
          profile: t("sections.profile"),
          security: t("sections.security"),
          session: t("sections.session"),
        },
        nameLabel: t("nameLabel"),
        nameEmpty: t("nameEmpty"),
        nameEdit: t("nameEdit"),
        nameAdd: t("nameAdd"),
        nameSave: t("nameSave"),
        nameCancel: t("nameCancel"),
        nameInputLabel: t("nameInputLabel"),
        emailLabel: t("emailLabel"),
        emailVerified: t("emailVerified"),
        phoneLabel: t("phoneLabel"),
        phoneEmpty: t("phoneEmpty"),
        passwordLabel: t("passwordLabel"),
        passwordChange: t("passwordChange"),
        passwordHelper: t("passwordHelper"),
        eventsLabel: t("eventsLabel"),
        eventsTitle: t("eventsTitle"),
        eventsHelper: t("eventsHelper"),
        signOut: t("signOut"),
      }}
    />
  );
}
