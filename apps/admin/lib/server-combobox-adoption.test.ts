import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

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
});
