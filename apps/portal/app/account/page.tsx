"use client";

import { useCallback, useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import type { MyProfile } from "@ds/schemas";

import { authClient, AuthError } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error-message";
import { getMyProfile } from "@/lib/profile-client";
import {
  setDisplayName,
  DisplayNameError,
} from "@/lib/display-name-client";
import { initialsFromDisplayName } from "@/lib/display-name";

import { Avatar } from "@ds/design-system/avatar";
import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { Container } from "@ds/design-system/container";
import { FormError } from "@ds/design-system/form";
import { Input } from "@ds/design-system/input";

/*
 * 003 EARS-28 (design §12; GH #770) — the /account profile surface, replacing
 * the raw session-claims dump: the canvas «Разделы» composition of
 * `design-source/profile.dc.html` (blue poster header + one 720px column of
 * flat rows under §09 section rules — «Профиль» / «Безопасность» / «Сессия»).
 *
 * Data is the EARS-27 self-read (`GET /v1/me/profile` via `lib/profile-client`)
 * — the caller's OWN identity fields, never the session claims: `sub`, the
 * roles array, and the raw `mfa` boolean NEVER reach this DOM (requirements
 * Invariants). The display name edits inline through the EXISTING
 * `PUT /v1/me/display-name` (006 EARS-14; no new write endpoint); email is
 * read-only with its verified badge; phone is read-only with an explicit
 * «не указан» empty state (phone editing = the future secondary-identifier
 * increment). «Сменить пароль» hands off to the existing /reset flow
 * (EARS-11/12) — no in-page password form.
 *
 * Session behavior is unchanged (EARS-9): a 401 gets ONE silent refresh +
 * retry before redirecting to /login. Logout (EARS-10) revokes server-side
 * then routes to /login — same `data-testid="logout"` contract as before.
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; profile: MyProfile };

/** One flat label/value row of the «Разделы» column (canvas `rowFlat`). */
function ProfileRow({
  label,
  children,
  divider = true,
}: {
  label: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 py-4 layout:flex-row layout:items-center layout:gap-5 layout:py-5 ${
        divider ? "border-t border-border" : ""
      }`}
    >
      <span className="w-36 shrink-0 text-2xs font-extrabold uppercase tracking-micro text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/** §09 section header — uppercase micro-label + flat 2px ink rule. */
function SectionHeader({ children, first = false }: {
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-4 ${first ? "mb-2" : "mb-2 mt-10 layout:mt-12"}`}
    >
      <h2 className="text-caption font-extrabold uppercase tracking-micro whitespace-nowrap">
        {children}
      </h2>
      <span aria-hidden className="flex-1 border-t-2 border-foreground" />
    </div>
  );
}

/** A full-row link (password / events) with helper line + chevron. */
function RowLink({
  href,
  label,
  title,
  helper,
}: {
  href: string;
  label: string;
  title: string;
  helper: string;
}) {
  return (
    <NextLink
      href={href}
      className="flex flex-col gap-1.5 border-t border-border py-4 transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none layout:flex-row layout:items-center layout:gap-5 layout:py-5"
    >
      <span className="w-36 shrink-0 text-2xs font-extrabold uppercase tracking-micro text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        <span className="mt-1 block text-caption font-semibold text-muted-foreground">
          {helper}
        </span>
      </span>
      <span aria-hidden className="text-lg font-extrabold text-primary-action">
        →
      </span>
    </NextLink>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const t = useTranslations("account");
  const te = useTranslations("errors");
  const [state, setState] = useState<State>({ kind: "loading" });

  // Inline display-name edit state (canvas: Изменить → input + Сохранить/Отмена).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      router.replace("/login");
    }
  }

  function startEdit(current: string | null) {
    setDraft(current ?? "");
    setSaveError(null);
    setEditing(true);
  }

  async function saveName() {
    const trimmed = draft.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // The EXISTING 006 EARS-14 write — same SSOT validation server-side.
      await setDisplayName(trimmed);
      // Functional update: the handler closure may be a render behind by the
      // time the write resolves — never overwrite with a stale profile.
      setState((prev) =>
        prev.kind === "ready"
          ? {
              kind: "ready",
              profile: { ...prev.profile, displayName: trimmed },
            }
          : prev,
      );
      setEditing(false);
    } catch (err) {
      // #175 actionable-errors rule: route the failure through the shared
      // mapper (429 → too-many-attempts, 5xx/network → unavailable; the
      // validation/auth outcome stays the per-action generic). The
      // display-name client throws its own typed error — re-express it as
      // `AuthError` so the mapper can read the status.
      const mapped =
        err instanceof DisplayNameError
          ? new AuthError(err.status, err.message)
          : err;
      setSaveError(authErrorMessage(mapped, te, t("nameError")));
    } finally {
      setSaving(false);
    }
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
  const initials = profile.displayName
    ? initialsFromDisplayName(profile.displayName)
    : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Blue poster header (canvas «Разделы» masthead). */}
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          <h1 className="text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-caption font-semibold opacity-90">
            {t("subtitle")}
          </p>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
        <div className="max-w-2xl">
          {/* ── Профиль ── */}
          <SectionHeader first>{t("sections.profile")}</SectionHeader>

          <ProfileRow label={t("nameLabel")} divider={false}>
            {editing ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveName();
                    }
                    if (e.key === "Escape") setEditing(false);
                  }}
                  aria-label={t("nameInputLabel")}
                  maxLength={100}
                  autoFocus
                  className="min-w-0 flex-1"
                  data-testid="profile-name-input"
                />
                <Button
                  type="button"
                  onClick={() => void saveName()}
                  loading={saving}
                  disabled={!draft.trim()}
                  data-testid="profile-name-save"
                >
                  {t("nameSave")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  data-testid="profile-name-cancel"
                >
                  {t("nameCancel")}
                </Button>
                {saveError ? (
                  <FormError className="w-full">{saveError}</FormError>
                ) : null}
              </div>
            ) : (
              <>
                <span className="flex min-w-0 flex-1 items-center gap-3.5">
                  {initials ? (
                    <Avatar aria-hidden data-testid="profile-avatar">
                      {initials}
                    </Avatar>
                  ) : null}
                  <span
                    className={
                      profile.displayName
                        ? "truncate font-bold"
                        : "font-semibold text-muted-foreground"
                    }
                    data-testid="profile-name"
                  >
                    {profile.displayName ?? t("nameEmpty")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => startEdit(profile.displayName)}
                  className="self-start text-sm font-extrabold text-primary-action underline decoration-2 underline-offset-4 transition-colors hover:text-primary-action/80 focus-visible:shadow-focus focus-visible:outline-none layout:self-auto"
                  data-testid="profile-name-edit"
                >
                  {profile.displayName ? t("nameEdit") : t("nameAdd")}
                </button>
              </>
            )}
          </ProfileRow>

          <ProfileRow label={t("emailLabel")}>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <span className="truncate font-bold" data-testid="profile-email">
                {profile.email}
              </span>
              {profile.emailVerified ? (
                <Badge
                  className="border-2 border-current bg-transparent text-success"
                  data-testid="profile-email-verified"
                >
                  {t("emailVerified")}
                </Badge>
              ) : null}
            </span>
          </ProfileRow>

          <ProfileRow label={t("phoneLabel")}>
            <span
              className={
                profile.phone
                  ? "font-bold"
                  : "font-semibold text-muted-foreground"
              }
              data-testid="profile-phone"
            >
              {profile.phone ?? t("phoneEmpty")}
            </span>
          </ProfileRow>

          {/* ── Безопасность ── */}
          <SectionHeader>{t("sections.security")}</SectionHeader>
          <RowLink
            href="/reset"
            label={t("passwordLabel")}
            title={t("passwordChange")}
            helper={t("passwordHelper")}
          />

          {/* ── Сессия ── */}
          <SectionHeader>{t("sections.session")}</SectionHeader>
          <RowLink
            href="/account/events"
            label={t("eventsLabel")}
            title={t("eventsTitle")}
            helper={t("eventsHelper")}
          />
          <button
            type="button"
            onClick={onLogout}
            className="w-full border-t border-border py-4 text-left font-extrabold text-destructive-text transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none layout:py-5"
            data-testid="logout"
          >
            {t("signOut")}
          </button>
        </div>
      </Container>
    </main>
  );
}
