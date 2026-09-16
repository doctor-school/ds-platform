/**
 * The host-selection contract of the C6 regression suite (staging/regression-contour
 * tech spec §6.1, Issue #2067).
 *
 * Each spec feature file declares, ONCE at Feature level, which storefront runs
 * it. The Playwright projects then select POSITIVELY (`@host:academy or
 * @host:both`), which is what makes an untagged file a hard error rather than a
 * silent one: under a negative expression (`not @host:doctor`) an untagged file
 * runs EVERYWHERE, so an admin-only or API-only spec lands on both storefronts
 * and reports false reds; under a positive expression it runs NOWHERE, and a
 * scenario that quietly stopped existing is worse than a red one. The structural
 * check below closes that hole at generation time.
 */

/** The tag vocabulary. `admin` is deliberately selected by NO storefront project. */
export const HOST_TAG_VALUES = ["academy", "doctor", "both", "admin"] as const;

export type HostTagValue = (typeof HOST_TAG_VALUES)[number];

/** A storefront that owns a Playwright project in `playwright.config.ts`. */
export type StorefrontHostId = "academy" | "doctor";

/** A Gherkin tag line: only tag tokens on it (the scenario-coverage lint's rule). */
const TAG_LINE_RE = /^\s*@\S+(\s+@\S+)*\s*$/;
const FEATURE_RE = /^\s*Feature\b/;
/** Any `@host:…` token, valid value or not — an unknown value must be REPORTED, not ignored. */
const HOST_TAG_RE = /^@host:\S*$/;

/**
 * The `@host:*` tokens of the tag block that belongs to `Feature:`.
 *
 * Comment and blank lines between the tag block and `Feature:` are allowed (every
 * spec feature file opens with a comment header). Any other content line ends the
 * block, so a stray tag line earlier in the file cannot be mistaken for the
 * Feature's own. Scenario-level tags are never read here: this is the
 * Feature-level declaration, and Gherkin inherits it onto every scenario.
 */
export function featureHostTags(text: string): string[] {
  let pending: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    if (TAG_LINE_RE.test(raw)) {
      pending.push(...raw.trim().split(/\s+/).filter(Boolean));
      continue;
    }
    if (FEATURE_RE.test(raw)) break;
    pending = [];
  }
  return pending.filter((tag) => HOST_TAG_RE.test(tag));
}

/**
 * `null` when the file carries exactly one valid Feature-level host tag;
 * otherwise the human-readable reason, which the CLI prints beside the path.
 */
export function hostTagViolation(text: string): string | null {
  const tags = featureHostTags(text);
  const [tag] = tags;
  if (tag === undefined) {
    return `no @host: tag above \`Feature:\` (expected one of ${HOST_TAG_VALUES.map(
      (value) => `@host:${value}`,
    ).join(", ")})`;
  }
  if (tags.length > 1) {
    return `${tags.length} host tags above \`Feature:\` (${tags.join(
      ", ",
    )}) — exactly one is allowed`;
  }
  const value = tag.slice("@host:".length);
  if (!(HOST_TAG_VALUES as readonly string[]).includes(value)) {
    return `unknown host tag ${tag} (expected one of ${HOST_TAG_VALUES.map(
      (known) => `@host:${known}`,
    ).join(", ")})`;
  }
  return null;
}

/**
 * How many feature files each host tag claims — the per-host suite SIZE, printed
 * by `bin/check-host-tags.ts` on success.
 *
 * Retargeting a Feature tag (say `@host:both` → `@host:admin`) removes a whole
 * spec from both storefront suites while every structural check stays green, so
 * the counts are the cheap CI-log signal that a suite just shrank. Only files
 * that pass {@link hostTagViolation} contribute; an invalid or missing tag is the
 * CLI's error path, never a silently miscounted row.
 */
export function hostTagCounts(
  texts: readonly string[],
): Record<HostTagValue, number> {
  const counts = Object.fromEntries(
    HOST_TAG_VALUES.map((value) => [value, 0]),
  ) as Record<HostTagValue, number>;
  for (const text of texts) {
    if (hostTagViolation(text) !== null) continue;
    const value = featureHostTags(text)[0]!.slice("@host:".length);
    counts[value as HostTagValue] += 1;
  }
  return counts;
}

/**
 * The playwright-bdd tag expression for a storefront project: its own features
 * plus the shared ones. Lowercase `or` is the Cucumber tag-expression operator
 * playwright-bdd 9.2 parses.
 */
export function tagExpressionFor(hostId: StorefrontHostId): string {
  return `@host:${hostId} or @host:both`;
}
