"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";

import type { MyProfile } from "@ds/schemas";
import { initialsFromDisplayName } from "@ds/room/display-name";
import { Container } from "@ds/design-system/container";
import { AccountProfileCard } from "@ds/design-system/account-profile-card";
import { accountPhoneActions, createAuthClient } from "@ds/auth-flow/client";
import { authErrorMessage } from "@ds/auth-flow/errors";
import type {
  AuthFlowApiConfig,
  AuthFlowErrorCopy,
} from "@ds/auth-flow/host-config";
import { SIGN_OUT_DESTINATION } from "@ds/auth-flow/host-config";
import { fetchSection as fetchCongressSection } from "@ds/congress-submissions/client";

import { ACCOUNT_COPY as COPY } from "../copy/account-copy";

/**
 * The CLIENT half of the one account cabinet (003 EARS-27/28 «Профиль аккаунта
 * v1»; wave-4 entry gate rows 2–17). Whether a visitor may see it at all is
 * decided on the server by `./account-page.tsx`; a guest never reaches this
 * component. What stays here is what genuinely needs the browser — the EARS-27
 * self-read, the inline display-name edit, the EARS-9 silent refresh, sign-out
 * and the congress-section read.
 *
 * The composition is the shared `<AccountProfileCard>` block; the reads and the
 * write ride the host's bound `@ds/auth-flow` client built from its `api`
 * (gate D2: the endpoints `GET /v1/me/profile` and `PUT /v1/me/display-name`
 * reached through THIS origin's rewrite, so the origin-locked session cookie
 * rides them, ADR-0015 §4). The session claims — `sub`, the roles array, the
 * `mfa` boolean — never reach this DOM (requirements Invariants).
 */

export interface AccountCabinetProps {
  /** The host's auth-flow api paths — the cabinet's transport (gate D2). */
  api: AuthFlowApiConfig;
  /** The expired-session bounce, carrying the account route (row 5). */
  expiredHref: string;
  /** «Сменить пароль» — the host reset route carrying the account route (row 12). */
  passwordHref: string;
  /** «Мои события» (row 13). */
  eventsHref: string;
  /** «Мои заявки на Конгресс» (046 EARS-4, row 14); `null` = no read, no row. */
  congressPath: string | null;
  /** The host's resolved auth error copy the save-error mapper reads (row 10). */
  saveErrors: AuthFlowErrorCopy;
}

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; profile: MyProfile };

export function AccountCabinet({
  api,
  expiredHref,
  passwordHref,
  eventsHref,
  congressPath,
  saveErrors,
}: AccountCabinetProps) {
  const router = useRouter();
  // Keyed on the VALUES of `api`, never its identity: `api` is a serialised
  // server prop, so every `router.refresh()` (the display-name save calls one)
  // hands a new but equal object. An identity key would rebuild the client,
  // re-run `load` and fire an extra profile read after every save.
  const { basePath, registerPath, verifyPath } = api;
  const authClient = useMemo(
    () => createAuthClient({ basePath, registerPath, verifyPath }),
    [basePath, registerPath, verifyPath],
  );
  // 003 EARS-47/48/59 — the shared phone-row transport over this host's client.
  const phoneActions = useMemo(
    () => accountPhoneActions(authClient),
    [authClient],
  );
  const [state, setState] = useState<State>({ kind: "loading" });
  const [congressRegistered, setCongressRegistered] = useState(false);

  const load = useCallback(async () => {
    // 003 EARS-9: one silent refresh + one retry before the door.
    let profile: MyProfile | null = null;
    try {
      profile = await authClient.profile();
      if (!profile) {
        try {
          await authClient.refresh();
          profile = await authClient.profile();
        } catch {
          // refresh 401 (no/expired/reused session) — fall through to the door.
        }
      }
    } catch {
      setState({ kind: "error" });
      return;
    }
    if (profile) {
      setState({ kind: "ready", profile });
    } else {
      // 014 EARS-6 — the session EXPIRED while the cabinet was open (the server
      // let this render, so there was a session a moment ago). The bounce
      // carries the cabinet, so signing back in returns the doctor to it.
      // Sign-out below stays bare on purpose: leaving is not a bounce.
      router.replace(expiredHref);
    }
  }, [authClient, expiredHref, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // 046 EARS-4 — read after the profile resolves, so the EARS-9 refresh has
  // already renewed the session this call rides on; only on a host whose config
  // names the congress section.
  const ready = state.kind === "ready";
  useEffect(() => {
    if (!ready || congressPath === null) return;
    let live = true;
    fetchCongressSection()
      .then((section) => {
        if (live) setCongressRegistered(section.registered);
      })
      .catch(() => {
        // No congress event, no session yet or offline — the row stays hidden.
      });
    return () => {
      live = false;
    };
  }, [ready, congressPath]);

  async function onSignOut() {
    try {
      await authClient.logout();
    } catch {
      // A refused or unreachable revoke is swallowed HERE rather than escaping
      // as an unhandled rejection: the block fires this handler as
      // `void onSignOut()`, and the `finally` below already does the one thing
      // that matters — the doctor leaves (gate row 11).
    } finally {
      // #2488: the package's one sign-out destination, the same on both
      // storefronts. 008 EARS-5 (#2281): the header is server-rendered, so every
      // page visited while signed in sits in the client Router Cache with the
      // signed-in chip; the refresh drops that cache, so browser Back re-reads
      // the header from the server, which now finds no session.
      router.replace(SIGN_OUT_DESTINATION);
      router.refresh();
    }
  }

  async function onSaveDisplayName(displayName: string) {
    // The EXISTING 006 EARS-14 write — same SSOT validation server-side.
    await authClient.setDisplayName({ displayName });
    // Functional update: the handler closure may be a render behind by the time
    // the write resolves — never overwrite with a stale profile.
    setState((prev) =>
      prev.kind === "ready"
        ? { kind: "ready", profile: { ...prev.profile, displayName } }
        : prev,
    );
    // 008 EARS-5 (#2281): the header chip's initials are read on the SERVER and
    // this screen stays mounted — re-render the server tree so the persistent
    // header picks the new name up. Client state here is preserved.
    router.refresh();
  }

  function resolveSaveError(err: unknown) {
    // #175 actionable errors through the shared mapper: 429 → too-many-attempts,
    // 5xx / a thrown fetch → unavailable, any other refusal → the per-action
    // generic.
    return authErrorMessage(err, saveErrors, COPY.nameError);
  }

  if (state.kind === "loading") {
    return (
      <div className="bg-background text-foreground">
        <Container className="py-16">
          <p className="text-sm text-muted-foreground" role="status">
            {COPY.loading}
          </p>
        </Container>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="bg-background text-foreground">
        <Container className="py-16">
          <p className="text-sm text-muted-foreground" role="alert">
            {COPY.error}
          </p>
        </Container>
      </div>
    );
  }

  const { profile } = state;

  return (
    <AccountProfileCard
      profile={profile}
      copy={COPY.card}
      initials={
        profile.displayName
          ? initialsFromDisplayName(profile.displayName)
          : null
      }
      passwordHref={passwordHref}
      eventsHref={eventsHref}
      congressHref={congressRegistered ? congressPath : null}
      renderLink={({ href, children }) =>
        // 003 EARS-61 — the reset entry acts only on a top-level document
        // navigation: a plain link, never a router link that prefetches it.
        href === passwordHref ? (
          <a href={href}>{children}</a>
        ) : (
          <NextLink href={href}>{children}</NextLink>
        )
      }
      onSaveDisplayName={onSaveDisplayName}
      resolveSaveError={resolveSaveError}
      onSignOut={onSignOut}
      phoneActions={phoneActions}
    />
  );
}
