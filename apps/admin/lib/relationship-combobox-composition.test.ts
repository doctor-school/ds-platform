import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SURFACES = [
  ["../components/event-projects-panel.tsx", "event-project-link-search"],
  ["../components/event-experts-panel.tsx", "event-expert-search"],
  ["../components/event-directions-panel.tsx", "event-direction-link-search"],
  ["../components/project-experts-panel.tsx", "project-expert-link-search"],
  ["../components/project-partners-panel.tsx", "project-partner-link-search"],
  ["../components/relationship-endpoint-picker.tsx", "testIdPrefix}-search"],
] as const;

describe("EARS-22: relationship add-picker composition", () => {
  for (const [relativePath, oldSearchHandle] of SURFACES) {
    it(`EARS-22: uses one closed in-panel searchable Combobox in ${relativePath}`, () => {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      );

      expect(source).toContain("<Combobox");
      expect(source).toContain("onSearchChange=");
      expect(source).toContain("onLoadMore=");
      expect(source).toContain("loadMoreError=");
      expect(source).not.toContain(oldSearchHandle);
    });
  }

  // Source-level binding only: it proves the shared state helpers are the ones
  // wired in, not that the panels behave — the behaviour itself is asserted on
  // the pure state layer in `server-combobox.test.ts`.
  it("EARS-22: binds the exclusion prune and the retry action to the shared helpers", () => {
    const wrapper = readFileSync(
      fileURLToPath(new URL("./use-relationship-combobox.ts", import.meta.url)),
      "utf8",
    );
    expect(wrapper).toContain("pruneComboboxOptions");

    const hook = readFileSync(
      fileURLToPath(new URL("./use-server-combobox.ts", import.meta.url)),
      "utf8",
    );
    expect(hook).toContain("serverComboboxLoadAction");
  });
});
