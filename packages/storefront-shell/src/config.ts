/**
 * The values-only host configuration of the shared storefront chrome (#2180,
 * epic #2020 / ADR-0013 A1).
 *
 * The rule this file exists to enforce: the chrome COMPOSITION lives once, in
 * `storefront-header.tsx` / `storefront-footer.tsx`, and everything that differs
 * between `doctor.school` and `academy.doctor.school` is a VALUE passed in here.
 * No component in this package branches on {@link StorefrontHostId} — the id is
 * carried only so a host can be addressed from CSS or an e2e selector via the
 * `data-host` attribute the header and footer paint.
 *
 * The nav is deliberately NOT defaulted here: the owner decision of 2026-09-10
 * (recorded in Issue #2180 and the merged 008 / 017 spec deltas) is «Эфиры»
 * only, on BOTH hosts, growing with features 015 / 016 and the partner surface —
 * a list that belongs to the host, not to the package.
 */

/**
 * 008 EARS-4/5/6 · 017 EARS-1 — the RESOLVED sign-in state the chrome renders
 * its auth cluster from (#2180).
 *
 * Data, never markup: the host decides WHERE the session is read (the doctor
 * storefront resolves it on the server from the request headers, the academy
 * from a client profile read) and the package decides what it LOOKS like. The
 * `authCluster` ReactNode slot this replaced is what let the two storefronts'
 * chips drift to 194×44 and 191×48.
 *
 * `label` is the affordance's copy in every branch — read from the host's
 * catalog (008 EARS-13), never hardcoded here. On the signed-in branch the
 * presence of `initials` picks the chip: OMIT it for the labelled text chip the
 * doctor storefront ships («Личный кабинет», 017 EARS-1, canvas lines 192/209),
 * pass it — `null` included, for a doctor with no saved display name (#997) —
 * for the academy's initials chip, where `label` becomes the accessible name.
 */
export type ShellAuthState =
  | { status: "loading" }
  | { status: "guest"; loginHref: string; label: string }
  | {
      status: "doctor";
      profileHref: string;
      label: string;
      initials?: string | null;
    };

/** The two storefronts that mount this chrome. */
export type StorefrontHostId = "doctor" | "academy";

/** A labelled destination — a nav item, a footer document, the cross link. */
export interface ShellLink {
  label: string;
  href: string;
}

export interface StorefrontShellConfig {
  /** Identity only — never a render branch. Painted as `data-host`. */
  host: StorefrontHostId;
  /** The white wordmark on the navy band and where it leads. */
  logo: { alt: string; href: string };
  /**
   * The BBM announcement micro-band above the header. Host-AGNOSTIC copy by
   * owner decision (2026-09-10) — it is still a config value, because the band
   * belongs to the product, not to this package.
   */
  topbar: { text: string };
  /**
   * The header search. `null` on a host that has no results surface yet — the
   * input is then not rendered at all rather than shipped inert (AGENTS.md §6
   * no-stub). `action` is the form target; this package never invents one.
   */
  search: { placeholder: string; action: string } | null;
  /** The top nav, in order. Rendered verbatim on desktop and in the mobile menu. */
  nav: readonly ShellLink[];
  footer: {
    /** Column heading over the {@link StorefrontShellConfig.nav} repeat («Разделы»). */
    navTitle: string;
    /** Column heading over {@link documents} («Документы и контакты»). */
    documentsTitle: string;
    documents: readonly ShellLink[];
    /** The SINGLE crossing to the sibling storefront (017 EARS-12). */
    cross: { title: string; label: string; href: string; note: string };
    /** The brand foot-note, one rendered line per entry. */
    note: readonly string[];
    /**
     * The giant decorative wordmark. `fontSize` is a CSS length in
     * container-query units against the footer's own width (the canvas
     * `giantSize`, e.g. `min(15.07cqw,240px)`).
     *
     * The canvas (`design-source/ds-shell.dc.html`) fits the wordmark with a
     * ResizeObserver: it rescales until the MEASURED glyph run is 96.5% of the
     * box, clamped to 26..240px. The code reproduces that with no script,
     * because for one fixed string in one fixed face the run width is linear in
     * the font size — so the coefficient is simply
     * `96.5 / (run width per 1px of font size)`, measured in the running UI for
     * Inter 800 at the `.giant` tracking: 6.4003 for «Doctor.School» (=> 15.07)
     * and 11.0123 for «Academy.Doctor.School» (=> 8.76). The `min()` arm is the
     * canvas clamp.
     *
     * CHANGING THE TEXT OR THE TYPEFACE INVALIDATES THE COEFFICIENT — re-measure
     * it, or the box clips the word again the way #2234 found it clipped. The
     * per-host `/documents` Playwright rows (008 EARS-14.5, 017 EARS-1.13)
     * are what hold that honest.
     */
    giant: { text: string; fontSize: string };
    /**
     * Route patterns the FOOTER alone is hidden on, when they differ from the
     * chrome-wide {@link StorefrontShellConfig.hiddenOnPaths}. Absent (the
     * common case) means the footer follows the chrome-wide list exactly.
     *
     * It exists because the two halves of the chrome can legitimately disagree
     * about one route: the academy home mounts the shared HEADER (#1877) while
     * painting a page-owned `<footer>` of its own, so the shared footer must
     * stand down there — and only there — or the document carries two
     * `contentinfo` landmarks. Same grammar as the chrome-wide list.
     */
    hiddenOnPaths?: readonly string[];
  };
  /**
   * Route patterns on which the chrome renders NOTHING — the host's own auth or
   * room surfaces carry their own chrome. Absent (the common case) means the
   * chrome is unconditional and NO client boundary is added for it.
   *
   * Patterns are SEGMENT-wise, not prefixes (see {@link matchesPathPattern}), so
   * a host can name a route that sits inside a listing it must not hide — the
   * portal's webinar room, one segment below a listing that stays chromed, is
   * exactly that case.
   */
  hiddenOnPaths?: readonly string[];
}

/**
 * Segment-wise route match — the grammar behind
 * {@link StorefrontShellConfig.hiddenOnPaths}.
 *
 * Both the pattern and the pathname are split on `/` and compared segment by
 * segment:
 *
 * - a `*` segment matches EXACTLY ONE segment, so the star form of
 *   `/webinars/:slug/room` hides the room of any webinar without touching
 *   `/webinars` or the webinar page itself;
 * - a trailing `**` segment matches ONE OR MORE remaining segments, so the star
 *   form of `/login/...` hides everything below `/login` but not `/login`;
 * - every other segment is a literal, and the segment counts must agree.
 *
 * A plain literal pattern is therefore an EXACT route, never a prefix: `/login`
 * hides `/login` alone. That is the semantics the hosts already implement by
 * hand — the portal's auth set is a `Set` of exact pathnames — and a prefix
 * matcher could not express the room route at all, since the prefix `/webinars`
 * would swallow the listing.
 */
export function matchesPathPattern(pathname: string, pattern: string): boolean {
  const path = pathname.split("/");
  const parts = pattern.split("/");

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "**") {
      // Only meaningful as the LAST segment, and only over a non-empty tail.
      return index === parts.length - 1 && path.length > index;
    }
    if (index >= path.length) return false;
    if (part === "*") continue;
    if (part !== path[index]) return false;
  }

  return path.length === parts.length;
}

/**
 * True when the chrome must render nothing here. Exported so the header, the
 * footer and their tests share ONE definition of "hidden here".
 */
export function isHiddenPath(
  pathname: string,
  patterns: readonly string[] | undefined,
): boolean {
  if (!patterns) return false;
  return patterns.some((pattern) => matchesPathPattern(pathname, pattern));
}
