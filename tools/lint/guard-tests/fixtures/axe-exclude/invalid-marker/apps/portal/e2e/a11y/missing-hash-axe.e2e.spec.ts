import AxeBuilder from "@axe-core/playwright";

// FIXTURE (axe-exclude-lint): marker present but MISSING the `#N` issue ref → the
// exclude is still a finding (a marker without a tracked Issue tracks nothing).
export async function scan(page: unknown) {
  return new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .exclude(".bg-header") // axe-exclude-ok: band swallows toggle but no issue ref
    .analyze();
}
