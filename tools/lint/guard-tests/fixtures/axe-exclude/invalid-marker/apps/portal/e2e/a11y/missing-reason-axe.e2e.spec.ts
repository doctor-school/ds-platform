import AxeBuilder from "@axe-core/playwright";

// FIXTURE (axe-exclude-lint): marker carries a `#N` but NO reason → still a
// finding (the reason is what makes the tracked debt legible).
export async function scan(page: unknown) {
  return new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .exclude(".bg-header") // axe-exclude-ok: #785
    .analyze();
}
