import AxeBuilder from "@axe-core/playwright";

// FIXTURE (axe-exclude-lint): a container-band exclude carrying a VALID inline
// tracking marker (`#NNN` + reason) → clean (the guard's sanctioned escape).
export async function scan(page: unknown) {
  return new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    // axe-exclude-ok: #785 band swallows interactive toggle — leaf-scope tracked
    .exclude(".bg-header")
    .analyze();
}
