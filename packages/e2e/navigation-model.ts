/**
 * The HOST NAVIGATION MODEL — staging/regression-contour tech spec
 * `apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md`
 * §6.3, first bullet (Issue #2067).
 *
 * Each storefront exports its navigation as DATA from a React-free module next to
 * its shell configuration (`apps/portal/lib/navigation-model.ts`,
 * `apps/doctor/lib/navigation-model.ts`). The chrome is the shared
 * `@ds/storefront-shell` (#2180) and each host supplies only VALUES, so the
 * host's `lib/shell-config.ts` DERIVES the wordmark's target and the nav from
 * that array, and the host's auth-cluster mapping derives `loginHref` /
 * `profileHref` from it, instead of carrying inline `href` constants. Two things
 * follow, and both are the point:
 *
 *   • The model and the rendered bar cannot diverge — there is one list, not a
 *     list plus a render.
 *   • The derived navigation walk (`derived/`, deliverable 4) visits every item
 *     as a guest and as the golden signed-in doctor with ZERO edits to any list:
 *     a new chrome link enters the walk the moment it enters the model.
 *
 * This module carries the TYPES and the PURE projections only. It deliberately
 * imports nothing: `packages/**` may not reach into `apps/**`
 * (`local/package-import-boundary`, one-code-two-storefronts plan §3 rule 3), so
 * the host models are registered by PATH in `./hosts.ts` and loaded by the walk.
 */

/** Who a navigation item is rendered for. */
export type Audience = "guest" | "doctor" | "both";

/** The two visitor states the walk drives. `both` is an item property, never a visitor. */
export type Visitor = Exclude<Audience, "both">;

/**
 * The landing evidence §6.2 accepts — the page's `h1` text, or its `data-surface`
 * marker when the page owns no `h1`. Exactly one of the two: a union, not two
 * optional fields, so «neither was filled in» cannot typecheck.
 */
export type NavigationLanding =
  | { readonly h1: string; readonly surface?: never }
  | { readonly surface: string; readonly h1?: never };

/** One navigation destination the header renders and the walk visits. */
export interface NavigationItem {
  /**
   * Stable route id — how the header picks the item it renders in a given slot
   * and how a walk failure names the offender. Not user-visible.
   */
  readonly id: string;
  /**
   * The rendered label EXACTLY as the host passes it today: an i18n message key
   * on `apps/portal` (which carries `next-intl`), a Russian literal on
   * `apps/doctor` (which does not). Moving the constant into the model must not
   * change one rendered byte, so the label's FORM stays the host's.
   */
  readonly label: string;
  /** The href the header links to and the walk opens. */
  readonly href: string;
  /** What proves the visitor reached the right page, not just the right URL (§6.2). */
  readonly landing: NavigationLanding;
  /** Which visitor state renders the item. */
  readonly audience: Audience;
}

/** A host's navigation, in render order. */
export type NavigationModel = readonly NavigationItem[];

/** A resolved §6.2 assertion: which evidence to read, and the value to expect. */
export type LandingEvidence =
  | { readonly kind: "h1"; readonly value: string }
  | { readonly kind: "surface"; readonly value: string };

/**
 * The items a given visitor sees, in model order. `both` items belong to every
 * visitor; a `guest` item is never returned for a doctor and vice versa — the
 * walk would otherwise assert a landing the visitor cannot reach.
 */
export function itemsFor(
  model: NavigationModel,
  visitor: Visitor,
): readonly NavigationItem[] {
  return model.filter(
    (item) => item.audience === "both" || item.audience === visitor,
  );
}

/** Resolve an item's landing into the assertion the navigation step runs. */
export function landingEvidence(item: NavigationItem): LandingEvidence {
  return item.landing.h1 !== undefined
    ? { kind: "h1", value: item.landing.h1 }
    : { kind: "surface", value: item.landing.surface };
}

/**
 * Index a model by route id. A duplicate id THROWS rather than letting the later
 * item shadow the earlier one: a silently dropped item is a destination the walk
 * stops visiting, which is the exact blindness this contract exists to remove.
 */
export function byId(
  model: NavigationModel,
): Readonly<Record<string, NavigationItem>> {
  const index: Record<string, NavigationItem> = {};
  for (const item of model) {
    if (index[item.id]) {
      throw new Error(
        `navigation model: duplicate item id "${item.id}" — every destination needs its own id.`,
      );
    }
    index[item.id] = item;
  }
  return Object.freeze(index);
}
