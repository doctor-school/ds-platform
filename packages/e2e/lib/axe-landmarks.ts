/**
 * #2664 — the `<main>` landmark rules every page-level axe scan runs beside the
 * WCAG 2.0/2.1 A+AA tag set.
 *
 * axe ships these three as `best-practice` rules, so a scan filtered by
 * `.withTags(["wcag2a", …])` never evaluates them: a page with no `<main>`, with
 * two, or with one nested inside another was invisible to every page-level
 * gate. The rule they enforce: the route group's shell (its layout) owns the
 * page's ONE `<main>`; package compositions, design-system blocks and page
 * compositions render none (the room shell, which IS its group's shell, keeps
 * its own).
 *
 * Usage — `options` first, `withTags` second: the tag call writes `runOnly` onto
 * the options object, and an explicit `rules[id].enabled` wins over the tag
 * filter inside axe, so these run beside the WCAG set instead of replacing it:
 *
 *   new AxeBuilder({ page }).options({ rules: MAIN_LANDMARK_RULES }).withTags(WCAG_TAGS)
 */
export const MAIN_LANDMARK_RULES = {
  "landmark-one-main": { enabled: true },
  "landmark-no-duplicate-main": { enabled: true },
  "landmark-main-is-top-level": { enabled: true },
} as const satisfies Record<string, { enabled: boolean }>;
