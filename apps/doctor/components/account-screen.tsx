"use client";

import { useCallback, useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";

import type { MyProfile } from "@ds/schemas";
import { initialsFromDisplayName } from "@ds/room/display-name";

import { Container } from "@ds/design-system/container";
import { AccountProfileCard } from "@ds/design-system/account-profile-card";

import { AuthError } from "@ds/auth-flow/client";
import { withReturnContext } from "@ds/auth-flow/server";

import { authClient } from "@/lib/auth-flow-client";
import { DOCTOR_AUTH_FLOW } from "@/lib/auth-flow.host-config";
import { DOCTOR_AUTH_ROUTES } from "@/lib/auth-flow-routes";

/**
 * #1958 — the doctor storefront's `/account` projection.
 *
 * It is the SAME surface the Academy renders (003 EARS-27/28 «Профиль аккаунта
 * v1»), mounted through the shared `<AccountProfileCard>` block: the owner's
 * release-1 decision is a copy of the Academy cabinet, not a doctor-specific one
 * (017-design.md, action-cluster row). Feature 022 (#1791, R5) replaces this
 * projection with the full doctor cabinet.
 *
 * The HOST half — everything this file owns and the block does not:
 *   • RU LITERAL copy, because `apps/doctor` carries no `next-intl` (the
 *     `@ds/auth-flow/login` precedent); the strings are the Academy `ru.json`
 *     `account` block verbatim, so the two hosts read identically;
 *   • the doctor-origin transport (`@ds/auth-flow/client`, mounted by
 *     `lib/auth-flow.host-config.ts`): the shipped
 *     003/006 routes reached through THIS origin's rewrite, so the origin-locked
 *     `__Host-ds_session` cookie of `doctor.school` rides them (ADR-0015 §4);
 *   • the EARS-9 dance — one silent refresh and one retry before the door;
 *   • the route table: sign-out lands on the storefront home `/`, not on
 *     `/login` — the Academy's landing. A signed-out doctor belongs on the
 *     storefront, and the server-rendered 017 header flips back to the guest
 *     cluster on the `router.refresh()` that follows.
 *
 * «Мои события» IS ABSENT, and absent rather than dead: this host has no
 * `/account/events` route, so the row would link into a 404. The block hides a
 * row whose href is `null` (017 EARS-3 honest-empty), and that route is the
 * tracked follow-on slice of #1958 — not a stub standing in for it here.
 * «Сменить пароль», by contrast, is NOT absent and no longer crosses hosts: since
 * #1989 this storefront serves password recovery itself at `/reset`, so the row
 * links host-relative — the same decision the `/login` card on this host carries.
 */

const COPY = {
  loading: "Загружаем ваш профиль…",
  error: "Не удалось загрузить профиль. Обновите страницу.",
  card: {
    title: "Профиль",
    subtitle: "Данные аккаунта, вход и сессия",
    sections: {
      profile: "Профиль",
      security: "Безопасность",
      session: "Сессия",
    },
    nameLabel: "Имя",
    nameEmpty: "не указано",
    nameEdit: "Изменить",
    nameAdd: "Указать",
    nameSave: "Сохранить",
    nameCancel: "Отмена",
    nameInputLabel: "Отображаемое имя",
    emailLabel: "Email",
    emailVerified: "подтверждён",
    phoneLabel: "Телефон",
    phoneEmpty: "не указан",
    passwordLabel: "Пароль",
    passwordChange: "Сменить пароль",
    passwordHelper: "Отправим код для сброса пароля на email",
    eventsLabel: "События",
    eventsTitle: "Мои события",
    eventsHelper: "Эфиры, записи и сертификаты",
    signOut: "Выйти из аккаунта",
  },
  saveGeneric: "Не удалось сохранить. Попробуйте ещё раз.",
  saveTooMany: "Слишком много попыток — повторите через несколько минут.",
  saveUnavailable: "Сервис временно недоступен — попробуйте ещё раз.",
} as const;

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; profile: MyProfile };

/**
 * #175 actionable errors, mirroring the Academy mapper's OUTCOMES rather than
 * importing it: the portal maps through `next-intl`, which this host does not
 * have, so the same three outcomes are expressed in RU literals here.
 */
function resolveSaveError(err: unknown): string {
  if (err instanceof AuthError) {
    if (err.status === 429) return COPY.saveTooMany;
    if (err.status >= 500) return COPY.saveUnavailable;
    return COPY.saveGeneric;
  }
  // A thrown fetch (offline, DNS, aborted) is never a validation outcome.
  return COPY.saveUnavailable;
}

export function AccountScreen() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    // EARS-9: one silent refresh + one retry before the doctor is sent to /login.
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
      // Rule S3 — the EARS-9 session-expiry bounce is a bounce, so it carries
      // this page back, built by the shared helper out of the host's own route
      // values rather than spelled beside them.
      router.replace(
        withReturnContext(
          DOCTOR_AUTH_FLOW,
          DOCTOR_AUTH_ROUTES.login,
          DOCTOR_AUTH_ROUTES.account,
        ),
      );
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSaveDisplayName(displayName: string) {
    await authClient.setDisplayName({ displayName });
    setState((prev) =>
      prev.kind === "ready"
        ? { kind: "ready", profile: { ...prev.profile, displayName } }
        : prev,
    );
  }

  async function onSignOut() {
    try {
      await authClient.logout();
    } catch {
      // A refused or unreachable revoke is swallowed HERE rather than escaping as
      // an unhandled rejection: the block fires this handler as `void onSignOut()`,
      // so a rejecting host promise would surface only in the console while the
      // `finally` below already does the one thing that matters to the doctor.
    } finally {
      // Whether or not the revoke round-trip succeeded, the doctor intends to
      // leave. `refresh()` re-runs the SERVER render, which is where the 017
      // header decides its cluster (EARS-1) — without it the signed-in cluster
      // would survive this soft navigation.
      router.replace("/");
      router.refresh();
    }
  }

  if (state.kind === "loading") {
    return (
      <main className="bg-background text-foreground">
        <Container className="py-16">
          <p className="text-sm text-muted-foreground" role="status">
            {COPY.loading}
          </p>
        </Container>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="bg-background text-foreground">
        <Container className="py-16">
          <p className="text-sm text-muted-foreground" role="alert">
            {COPY.error}
          </p>
        </Container>
      </main>
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
      // Password recovery lives on THIS host since #1989 — the `(auth)/reset`
      // route projecting the shared `<PasswordRecoveryCard>` — so the row stays
      // on the storefront: a signed-in doctor changes a password and lands back
      // here, on the origin their session belongs to, instead of crossing to the
      // Academy and returning signed in somewhere else.
      //
      // Rule S3 — «lands back here» is a promise this row has to CARRY: the
      // `/reset` route resolves its own landing from the target it was handed,
      // so without it the doctor lands on the route's default rather than on the
      // page they left. Built from the host route constants through the shared
      // helper, never assembled as a literal.
      passwordHref={withReturnContext(
        DOCTOR_AUTH_FLOW,
        DOCTOR_AUTH_ROUTES.reset,
        DOCTOR_AUTH_ROUTES.account,
      )}
      eventsHref={null}
      renderLink={({ href, children }) => (
        <NextLink href={href}>{children}</NextLink>
      )}
      onSaveDisplayName={onSaveDisplayName}
      resolveSaveError={resolveSaveError}
      onSignOut={onSignOut}
    />
  );
}
