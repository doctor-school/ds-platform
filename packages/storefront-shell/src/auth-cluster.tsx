import { UserRound } from "lucide-react";
import { Button } from "@ds/design-system/button";

import type { ShellAuthState } from "./config";
import { GuestLoginLink } from "./guest-login-link";
import { SessionRecheck } from "./session-recheck";

/**
 * 008 EARS-4/5/6 · 017 EARS-1 — the storefront chrome's auth affordance, owned
 * by the PACKAGE and driven by data (#2180).
 *
 * It used to be a `ReactNode` slot each host filled, and that is precisely what
 * let the two storefronts drift: the academy assembled a 194×44 chip out of a
 * shared surface constant plus its own padding, the doctor host a 191×48 DS
 * button with a border, and the bar around them inherited the difference. Here
 * the host supplies only the resolved {@link ShellAuthState} — where the session
 * read happens stays a host decision (the doctor host resolves it on the server
 * from the request headers, the academy from a client profile read; #2027 gives
 * that read a shared home), the LOOK does not.
 *
 * Exactly one cluster element reaches the DOM in every state — never both
 * branches, never neither, at any width (017 EARS-1). `data-cluster` carries the
 * branch for e2e; the chip testids (`shell-login` / `shell-avatar`) are the same
 * on both hosts.
 *
 * The canvas signed-in cluster also draws a points plate
 * (`map.doctor.user.points`). It is NOT rendered and NOT stubbed: no shipped
 * contract in `packages/schemas` carries a points value, so drawing it would
 * mean inventing one or painting a placeholder number at a doctor — both
 * forbidden (AGENTS.md §6). It lands with its read contract, Issue #1559.
 *
 * 003 EARS-74 — the profile chip is a plain document `<a>`, not a router link,
 * like the guest link (EARS-61): a router link RSC-fetched `/account`, committed
 * its guest `redirect()` as an empty page and only then reached the sign-in
 * host (#3748). A document request goes straight there.
 */
/**
 * Where the cluster sits (#3629). Below `layout` it is the last item of the `≡`
 * menu panel (canvas `ds-shell.dc.html` line 53: `margin-top:4px`, the full
 * panel width); from `layout` up it is the bar's chip group after the theme
 * control, as it always was. Placement only — the chip's look is the DS
 * `header-action` variant, split at the same breakpoint.
 */
const CLUSTER_PLACEMENT =
  "mt-1 flex flex-col gap-3 layout:mt-0 layout:flex-row layout:items-center";

/** A doctor with no saved display name gets a neutral silhouette (#997). */
const avatarFallbackIcon = <UserRound aria-hidden="true" className="size-5" />;

export function ShellAuthCluster({ auth }: { auth: ShellAuthState }) {
  if (auth.status === "loading") {
    // The session read is still in flight: reserve the chip's box so the bar
    // neither flashes the wrong branch nor shifts when the answer lands.
    return (
      <div
        data-testid="shell-auth-cluster"
        data-cluster="loading"
        className="flex items-center gap-3"
      >
        <span className="inline-flex size-11 flex-none" aria-hidden />
      </div>
    );
  }

  if (auth.status === "guest") {
    return (
      <div
        data-testid="shell-auth-cluster"
        data-cluster="guest"
        className={CLUSTER_PLACEMENT}
      >
        {/* ONE guest control, «Войти / Регистрация» — the canvas
            `guestCluster.primary` (`ds-shell.dc.html` line 220), the same single
            label on both hosts (017 US-7). A «Войти» + «Регистрация» pair was
            the #2198 Stage-B finding. */}
        {/* #2487 — on an event page the link carries it as `returnTo`. */}
        <GuestLoginLink loginHref={auth.loginHref} label={auth.label} />
      </div>
    );
  }

  return (
    <div
      data-testid="shell-auth-cluster"
      data-cluster="doctor"
      className={CLUSTER_PLACEMENT}
    >
      {/* The signed-in destinations (`user.links` line 209) are NOT part of this
          cluster: the canvas draws them INSIDE the nav group, before the theme
          control (line 33, toggle line 35, chip line 36), so
          `storefront-header.tsx` renders them at the tail of the desktop nav and
          as `≡` rows below the `layout` breakpoint. The cluster stays what 017
          EARS-1 names — exactly one chip element, at every width. */}

      {auth.initials === undefined ? (
        // The labelled profile chip — the doctor storefront's «Личный кабинет»
        // (017 EARS-1, canvas lines 192/209). Same primitive and size as the
        // guest chip it replaces, so the bar's height never moves with the
        // session.
        <Button asChild variant="header-action" size="menu-chip">
          <a href={auth.profileHref} data-testid="shell-avatar">
            {auth.label}
          </a>
        </Button>
      ) : (
        // The initials chip — an icon-LINK to the profile, never a dropdown and
        // no «Выйти» (008 EARS-5/6). `initials: null` is a doctor with no saved
        // display name: the chip falls back to a neutral silhouette and still
        // navigates (#997).
        // Below `layout` the canvas menu primary carries the label (line 53,
        // `primary.label`); from `layout` up the square shows the initials.
        // One link, both texts, CSS picks — never a second chip (EARS-1).
        <Button asChild variant="header-action" size="menu-avatar">
          <a
            href={auth.profileHref}
            aria-label={auth.label}
            data-testid="shell-avatar"
          >
            <span className="layout:hidden">{auth.label}</span>
            <span className="hidden layout:inline-flex">
              {auth.initials ? auth.initials : avatarFallbackIcon}
            </span>
          </a>
        </Button>
      )}
      {/* 003 EARS-73 — only a signed-in render re-checks its session when the
          tab is returned to; it renders nothing. */}
      <SessionRecheck />
    </div>
  );
}
