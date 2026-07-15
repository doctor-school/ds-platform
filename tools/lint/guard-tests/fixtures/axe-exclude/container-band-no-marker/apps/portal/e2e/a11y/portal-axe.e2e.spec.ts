import AxeBuilder from "@axe-core/playwright";

// FIXTURE (axe-exclude-lint): a container-band exclude with NO tracking marker.
// The `.bg-header` band swallows arbitrary downstream content → finding.
export async function scan(page: unknown) {
  return new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .exclude(".bg-header")
    .analyze();
}
