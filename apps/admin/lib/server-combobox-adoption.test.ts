import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const resolve = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const source = (relativePath: string): string =>
  readFileSync(resolve(relativePath), "utf8");

/**
 * Every admin list route. EARS-23 is a claim about the SET, not about whichever
 * page happens to have been converted last — so the guard enumerates the routes
 * and a new list that hand-rolls its own toolbar fails here rather than in a
 * review someone might skip.
 */
const LIST_PAGES = [
  "../app/projects/page.tsx",
  "../app/experts/page.tsx",
  "../app/partners/page.tsx",
  "../app/directions/page.tsx",
  "../app/specialties/page.tsx",
  "../app/direction-specialties/page.tsx",
  "../app/direction-adjacency/page.tsx",
] as const;

/**
 * EARS-23 says a taxonomy SELECTOR uses «the shared search/select combobox» and a
 * taxonomy LIST applies every filter immediately. Both are one-implementation
 * claims, so they are guarded at the source level the way the #1638 audit found
 * them broken: two parallel state machines that drifted apart because nothing
 * asserted there was only supposed to be one.
 */
describe("EARS-23: one shared selector and one instant-apply list", () => {
  it("EARS-23.5: every server-backed selector runs on the shared hook", () => {
    for (const path of [
      "./use-relationship-combobox.ts",
      "../components/expert-form.tsx",
    ]) {
      expect(source(path)).toContain("useServerCombobox");
    }
  });

  it("EARS-23.2: no selector re-implements its own debounce or request epoch", () => {
    for (const path of [
      "./use-relationship-combobox.ts",
      "../components/expert-form.tsx",
      "../components/relationship-endpoint-picker.tsx",
    ]) {
      const text = source(path);
      expect(text).not.toContain("setTimeout");
      expect(text).not.toContain("Epoch");
    }
  });

  it("EARS-23.2: the block-tier list applies its filters without a submit control", () => {
    const text = source("../components/admin-data-list.tsx");

    expect(text).toContain('applyMode="instant"');
    expect(text).not.toContain("common.apply");
    expect(text).not.toContain('type="submit"');
  });

  it("EARS-23.3: the block-tier list renders every applied value as a removable chip", () => {
    const text = source("../components/admin-data-list.tsx");

    expect(text).toContain("applied={applied}");
    expect(text).toContain("removeFilterLabel=");
    expect(text).toContain("onRemove");
  });

  it("EARS-23.4: the block-tier list offers exactly one reset-all control", () => {
    const text = source("../components/admin-data-list.tsx");

    expect(text).toContain("onResetAll=");
    expect(text.match(/const resetAll =/g)).toHaveLength(1);
  });

  it("EARS-23.2: every admin list route mounts the one block-tier composition", () => {
    for (const path of LIST_PAGES) {
      const text = source(path);

      expect(text).toContain("AdminDataList");
      expect(text).toContain("ADMIN_DATA_LIST_INITIAL_QUERY");
    }
  });

  it("EARS-23.2: the submit-driven list shell is gone, not merely unused", () => {
    // A second toolbar that no page mounts is still a second toolbar: the next
    // list would find it and mount it. The deliverable is its DELETION.
    expect(existsSync(resolve("../components/admin-list-shell.tsx"))).toBe(
      false,
    );

    for (const path of LIST_PAGES) {
      expect(source(path)).not.toContain("AdminListShell");
    }
  });

  it("EARS-23.2: no list page hand-assembles its own row markup or actions column", () => {
    for (const path of LIST_PAGES) {
      const text = source(path);

      // The block owns the table: a page that still writes `<tr>`/`<td>` is
      // rendering beside the block instead of through it.
      expect(text).not.toContain("<tr");
      expect(text).not.toContain("<td");
      // A single-action list has no «Действия» column — the row IS the action.
      expect(text).not.toContain("columns.actions");
    }
  });
});
