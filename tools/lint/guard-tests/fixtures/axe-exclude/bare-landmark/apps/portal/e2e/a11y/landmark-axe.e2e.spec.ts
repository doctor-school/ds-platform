import AxeBuilder from "@axe-core/playwright";

// FIXTURE (axe-exclude-lint): a bare landmark element exclude (`main`) with no
// marker → finding (a whole landmark region escapes the scan).
export async function scan(page: unknown) {
  return new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .exclude("main")
    .analyze();
}
