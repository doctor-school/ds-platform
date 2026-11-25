import { describe, expect, it } from "vitest";

import { standRunFilter } from "./stand-run-filter";

describe("standRunFilter — the scenario filter `pnpm e2e:stage` hands every live-tier config", () => {
  it("compiles E2E_GREP into the config's grep, so `--grep` narrows a live leg", () => {
    const filter = standRunFilter({ E2E_GREP: "вход|выход" });
    expect(filter.grep).toBeInstanceOf(RegExp);
    expect(filter.grep?.test("выход из кабинета")).toBe(true);
    expect(filter.grep?.test("регистрация")).toBe(false);
    expect(filter).not.toHaveProperty("grepInvert");
  });

  it("compiles E2E_GREP_INVERT into grepInvert — the box-observing tests a PR-slot Actions run leaves out", () => {
    const filter = standRunFilter({ E2E_GREP_INVERT: "box-observing" });
    expect(filter.grepInvert?.test("a box-observing test")).toBe(true);
    expect(filter).not.toHaveProperty("grep");
  });

  it("is empty when neither is set, so a full run selects every test", () => {
    expect(standRunFilter({})).toEqual({});
    expect(standRunFilter({ E2E_GREP: "", E2E_GREP_INVERT: "" })).toEqual({});
  });
});
