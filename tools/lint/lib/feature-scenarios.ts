/**
 * tools/lint/lib/feature-scenarios.ts — the tag view of a spec `.feature` file,
 * shared by `scenario-coverage-lint.ts` and `scenario-proof-lint.ts`. It lives
 * here because a guard module runs its `main()` on import.
 */

/** A Gherkin tag line (only tag tokens on it). */
const TAG_LINE_RE = /^\s*@\S+(\s+@\S+)*\s*$/;
const SCENARIO_RE = /^\s*(Scenario|Scenario Outline|Example)\b/;
const FEATURE_RE = /^\s*Feature\b/;
const RULE_RE = /^\s*Rule\b/;
const EXAMPLES_RE = /^\s*(Examples|Scenarios)\s*:/;

export interface ExamplesTags {
  line: number;
  /** The block's own tags only (the outline's are on the scenario). */
  tags: string[];
}

export interface ScenarioTags {
  line: number;
  tags: string[];
  /**
   * The tags of the `Rule:` the scenario sits in, kept apart from `tags` so
   * the coverage guard's reading of `tags` is unchanged; a tag filter sees
   * both (Gherkin inherits them).
   */
  ruleTags: string[];
  /** A Scenario Outline's `Examples:` blocks, in file order (empty otherwise). */
  examples: ExamplesTags[];
}

/**
 * Parse a `.feature` file into one entry per scenario, carrying the scenario's
 * own tags plus the feature-level tags (Gherkin tag inheritance), and each
 * `Examples:` block of an outline with the tags written above that block —
 * Gherkin tags a block's rows with them, so one outline can run its rows in
 * different places.
 */
export function parseScenarios(text: string): ScenarioTags[] {
  const lines = text.split(/\r?\n/);
  const scenarios: ScenarioTags[] = [];
  let pending: string[] = [];
  let featureTags: string[] = [];
  let ruleTags: string[] = [];
  let seenFeature = false;
  lines.forEach((raw, idx) => {
    if (/^\s*#/.test(raw)) return;
    if (TAG_LINE_RE.test(raw)) {
      pending.push(...raw.trim().split(/\s+/).filter(Boolean));
      return;
    }
    if (!seenFeature && FEATURE_RE.test(raw)) {
      seenFeature = true;
      featureTags = pending;
      pending = [];
      return;
    }
    if (RULE_RE.test(raw)) {
      ruleTags = pending;
      pending = [];
      return;
    }
    if (SCENARIO_RE.test(raw)) {
      scenarios.push({
        line: idx + 1,
        tags: [...featureTags, ...pending],
        ruleTags,
        examples: [],
      });
      pending = [];
      return;
    }
    const current = scenarios[scenarios.length - 1];
    if (current && EXAMPLES_RE.test(raw)) {
      current.examples.push({ line: idx + 1, tags: pending });
      pending = [];
      return;
    }
    if (raw.trim() === "") return;
    // Any other content line ends a tag block that belongs to no scenario.
    if (pending.length > 0) pending = [];
  });
  return scenarios;
}
