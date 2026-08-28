import type { Locator } from "@playwright/test";

/**
 * Narrow a locator to what the operator can actually SEE.
 *
 * The `@ds/design-system` `DataTable` block (#1578) mounts BOTH responsive
 * variants — the ≥md column table and the <md record cards — and hides one with
 * `display:none` rather than unmounting it. Every row handle, every empty-state
 * string and the pagination readout therefore exist TWICE in the DOM at every
 * viewport width, which trips Playwright strict mode on any single-element
 * action even though the operator sees exactly one.
 *
 * That duplication is the block's rendering strategy, not a defect this app can
 * fix: `display:none` also keeps the hidden copy out of the accessibility tree,
 * so nothing is announced or focusable twice. What the specs owe is honesty
 * about which copy they assert on — hence a VISIBILITY filter and never
 * `.first()`, which would pass against whichever variant the DOM happened to
 * emit first regardless of the width under test.
 */
export function visible(locator: Locator): Locator {
  return locator.filter({ visible: true });
}
