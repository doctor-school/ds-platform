import { withReturnTarget } from "@ds/schemas";

/**
 * 024 design §8 — the host-config fields the doctor storefront passes to the
 * course path and step screens (ADR-0013 §A1: data only, no adapters).
 */
export type LearningHostConfig = {
  routes: {
    /** The course route prefix: `${courses}/${slug}` and `${courses}/${slug}/steps/${id}`. */
    courses: string;
    /** The sign-up door of the guest gate (it returns the doctor to `?from=`). */
    register: string;
  };
};

export const coursePathHref = (c: LearningHostConfig, slug: string): string =>
  `${c.routes.courses}/${encodeURIComponent(slug)}`;

export const stepHref = (
  c: LearningHostConfig,
  slug: string,
  stepId: string,
): string => `${coursePathHref(c, slug)}/steps/${encodeURIComponent(stepId)}`;

/** The guest gate's door, carrying the page as the same-origin return target. */
export const registerHref = (c: LearningHostConfig, back: string): string =>
  withReturnTarget(c.routes.register, back);
