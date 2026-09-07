"use client";

import * as React from "react";

import type { MyProfile } from "@ds/schemas";

import { Avatar } from "../primitives/avatar";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Container } from "../primitives/container";
import { FormError } from "../primitives/form";
import { Input } from "../primitives/input";
import { Link as DsLink } from "../primitives/link";

/**
 * `<AccountProfileCard>` (#1958) — the ONE canonical account-profile composition
 * both storefronts mount (AGENTS.md §6 «Cross-front capability reuse before
 * invention», ADR-0013 A1; registry row «Account profile surface»).
 *
 * It was lifted VERBATIM out of `apps/portal/app/account/page.tsx` (003 EARS-27/28,
 * design §12; GH #770): same elements, same order, same classes and the same
 * `data-testid` contract — only the app glue was replaced by props. The canvas is
 * unchanged (`design-source/profile.dc.html` «Разделы» — blue poster header over one
 * 720px column of flat rows under §09 section rules: «Профиль» / «Безопасность» /
 * «Сессия»).
 *
 * What lives HERE (presentation + the inline-edit mechanic):
 *   • the poster masthead and the three section rules,
 *   • the identity rows — avatar initials + display name, email with its verified
 *     badge, phone with its explicit empty state,
 *   • the inline display-name edit (Изменить, then input + Сохранить/Отмена; Enter
 *     submits, Escape cancels) including its pending and error presentation,
 *   • the two full-row links and the sign-out action.
 *
 * What stays in the HOST app (the blocks-tier contract, see `./index.ts`): the
 * EARS-27 self-read and its EARS-9 silent-refresh dance, the EARS-10 logout
 * transport and where it routes, the `PUT /v1/me/display-name` write, error
 * mapping, copy (the Academy passes `next-intl`, the doctor storefront RU
 * literals) and the route table.
 *
 * The profile itself is CONTROLLED by the host: the block never mutates it. A
 * successful `onSaveDisplayName` resolves, the block leaves edit mode, and the new
 * value reaches the DOM only once the host re-renders with it, so the surface can
 * never show a name the write did not actually persist.
 *
 * INVARIANT carried across the lift (003 requirements Invariants): the raw session
 * claims — `sub`, the roles array, the `mfa` boolean — have no prop here and cannot
 * reach this DOM.
 */

/** Every RU string the surface renders; no copy is hard-coded in the block. */
export interface AccountProfileCardCopy {
  title: string;
  subtitle: string;
  sections: { profile: string; security: string; session: string };
  nameLabel: string;
  nameEmpty: string;
  nameEdit: string;
  nameAdd: string;
  nameSave: string;
  nameCancel: string;
  nameInputLabel: string;
  emailLabel: string;
  emailVerified: string;
  phoneLabel: string;
  phoneEmpty: string;
  passwordLabel: string;
  passwordChange: string;
  passwordHelper: string;
  eventsLabel: string;
  eventsTitle: string;
  eventsHelper: string;
  signOut: string;
}

export interface AccountProfileCardProps {
  /** The EARS-27 self-read result the host owns and re-renders with. */
  profile: MyProfile;
  copy: AccountProfileCardCopy;
  /**
   * Avatar initials for the current display name, derived by the host (the
   * derivation lives in `@ds/room/display-name`, which the package tier does not
   * depend on). `null` renders no avatar.
   */
  initials?: string | null;
  /**
   * Change-password handoff target — the existing recovery flow on that host.
   * `null` HIDES the whole «Безопасность» section, for the same reason
   * {@link AccountProfileCardProps.eventsHref} hides its row: a host that has not
   * shipped a recovery door must not offer a link into a 404.
   */
  passwordHref?: string | null;
  /**
   * The «Мои события» target. `null` HIDES the row entirely rather than linking at
   * a route the host has not shipped: an honest empty beats a 404 (017 EARS-3).
   */
  eventsHref?: string | null;
  /**
   * Host anchor renderer — the apps pass the Next.js `<Link>` so client-side
   * navigation survives the lift. Defaults to a plain `<a>`.
   */
  renderLink?: (props: {
    href: string;
    children: React.ReactNode;
  }) => React.ReactNode;
  /**
   * Persist a trimmed, non-empty display name. Resolving leaves edit mode;
   * rejecting keeps the draft and shows the mapped message.
   */
  onSaveDisplayName: (displayName: string) => Promise<void>;
  /** Map a rejected save onto the host localized message (#175 actionable errors). */
  resolveSaveError: (error: unknown) => string;
  /** EARS-10 sign-out — the host revokes server-side and decides where it lands. */
  onSignOut: () => void | Promise<void>;
}

function defaultRenderLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return <a href={href}>{children}</a>;
}

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

/** Section header — uppercase micro-label + flat 2px ink rule (canvas §09). */
function SectionHeader({
  children,
  first = false,
}: {
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

/**
 * A full-row link (password / events) with helper line and chevron, composed the
 * sanctioned DS way (Stage-B owner finding, #818): the `Link` primitive carries the
 * interaction contract (transition, shadow-focus keyboard ring, active state) via
 * `asChild` over a classless host anchor, while the CANVAS-pinned row state
 * overrides the text-link look — hover is a bg wash (`profile.dc.html` «Разделы»
 * `style-hover`, whose light value IS the `muted` token), never an underline, and
 * the row text stays ink (`text-foreground`), not link blue (only the chevron
 * carries the accent).
 */
function RowLink({
  href,
  label,
  title,
  helper,
  renderLink,
}: {
  href: string;
  label: string;
  title: string;
  helper: string;
  renderLink: NonNullable<AccountProfileCardProps["renderLink"]>;
}) {
  return (
    <DsLink
      asChild
      className="flex flex-col gap-1.5 border-t border-border py-4 font-normal text-foreground hover:bg-muted hover:no-underline active:text-foreground layout:flex-row layout:items-center layout:gap-5 layout:py-5"
    >
      {renderLink({
        href,
        children: (
          <>
            <span className="w-36 shrink-0 text-2xs font-extrabold uppercase tracking-micro text-muted-foreground">
              {label}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{title}</span>
              <span className="mt-1 block text-caption font-semibold text-muted-foreground">
                {helper}
              </span>
            </span>
            <span
              aria-hidden
              className="text-lg font-extrabold text-primary-action"
            >
              →
            </span>
          </>
        ),
      })}
    </DsLink>
  );
}

export function AccountProfileCard({
  profile,
  copy,
  initials = null,
  passwordHref = null,
  eventsHref = null,
  renderLink = defaultRenderLink,
  onSaveDisplayName,
  resolveSaveError,
  onSignOut,
}: AccountProfileCardProps) {
  // Inline display-name edit state (canvas: Изменить, then input + Сохранить/Отмена).
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

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
      await onSaveDisplayName(trimmed);
      setEditing(false);
    } catch (err) {
      setSaveError(resolveSaveError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Blue poster header (canvas «Разделы» masthead). */}
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          <h1 className="text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
            {copy.title}
          </h1>
          <p
            className="mt-4 text-caption font-semibold opacity-90"
            data-testid="poster-decor"
          >
            {copy.subtitle}
          </p>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
        <div className="max-w-2xl">
          <SectionHeader first>{copy.sections.profile}</SectionHeader>

          <ProfileRow label={copy.nameLabel} divider={false}>
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
                  aria-label={copy.nameInputLabel}
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
                  {copy.nameSave}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  data-testid="profile-name-cancel"
                >
                  {copy.nameCancel}
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
                    {profile.displayName ?? copy.nameEmpty}
                  </span>
                </span>
                <DsLink
                  asChild
                  className="self-start text-sm font-extrabold layout:self-auto"
                >
                  <button
                    type="button"
                    onClick={() => startEdit(profile.displayName)}
                    data-testid="profile-name-edit"
                  >
                    {profile.displayName ? copy.nameEdit : copy.nameAdd}
                  </button>
                </DsLink>
              </>
            )}
          </ProfileRow>

          <ProfileRow label={copy.emailLabel}>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <span className="truncate font-bold" data-testid="profile-email">
                {profile.email}
              </span>
              {profile.emailVerified ? (
                // AA remap (#270 precedent, mirrored from the webinar-card
                // registered marker): the canvas paints the badge green.500,
                // which fails the 4.5:1 normal-text floor on the light
                // background and the palette has no darker AA green — so the
                // LABEL takes AA ink and only the decorative check keeps the
                // success hue (redundant with the label, WCAG 1.4.11 exempt).
                <Badge
                  className="gap-1.5 border-2 border-current bg-transparent text-foreground"
                  data-testid="profile-email-verified"
                >
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  {copy.emailVerified}
                </Badge>
              ) : null}
            </span>
          </ProfileRow>

          <ProfileRow label={copy.phoneLabel}>
            <span
              className={
                profile.phone
                  ? "font-bold"
                  : "font-semibold text-muted-foreground"
              }
              data-testid="profile-phone"
            >
              {profile.phone ?? copy.phoneEmpty}
            </span>
          </ProfileRow>

          {passwordHref ? (
            <>
              <SectionHeader>{copy.sections.security}</SectionHeader>
              <RowLink
                href={passwordHref}
                label={copy.passwordLabel}
                title={copy.passwordChange}
                helper={copy.passwordHelper}
                renderLink={renderLink}
              />
            </>
          ) : null}

          <SectionHeader>{copy.sections.session}</SectionHeader>
          {eventsHref ? (
            <RowLink
              href={eventsHref}
              label={copy.eventsLabel}
              title={copy.eventsTitle}
              helper={copy.eventsHelper}
              renderLink={renderLink}
            />
          ) : null}
          <Button
            variant="ghost"
            type="button"
            onClick={() => void onSignOut()}
            className="w-full justify-start text-left font-extrabold text-destructive-text"
            data-testid="logout"
          >
            {copy.signOut}
          </Button>
        </div>
      </Container>
    </main>
  );
}
