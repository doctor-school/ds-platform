import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SURFACES = [
  ["../components/event-projects-panel.tsx", "event-project-link-search"],
  ["../components/event-experts-panel.tsx", "event-expert-search"],
  ["../components/event-topics-panel.tsx", "event-topic-link-search"],
  ["../components/project-experts-panel.tsx", "project-expert-link-search"],
  ["../components/project-partners-panel.tsx", "project-partner-link-search"],
  ["../components/relationship-endpoint-picker.tsx", "testIdPrefix}-search"],
] as const;

describe("EARS-22 relationship add-picker composition", () => {
  for (const [relativePath, oldSearchHandle] of SURFACES) {
    it(`uses one closed in-panel searchable Combobox in ${relativePath}`, () => {
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
});
