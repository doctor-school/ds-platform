import { describe, expect, it } from "vitest";

import { ACCOUNT_COPY } from "./account-copy";

/** Every string leaf of a copy object, with its dotted path. */
function leaves(value: unknown, path = ""): Array<[string, unknown]> {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      leaves(v, path ? `${path}.${k}` : k),
    );
  }
  return [[path, value]];
}

describe("wave-4 gate row 15: the cabinet's default copy", () => {
  it("003 EARS-28: the default copy satisfies the whole card copy contract, every key non-empty", () => {
    const entries = leaves(ACCOUNT_COPY);
    expect(entries.length).toBeGreaterThan(40);
    for (const [path, value] of entries) {
      if (typeof value === "function") continue;
      expect(typeof value, path).toBe("string");
      expect((value as string).trim(), path).not.toBe("");
    }
    // The one formatted sentence renders its count.
    expect(ACCOUNT_COPY.card.phone.resendCountdown(42)).toBe(
      "Отправить снова · 42 с",
    );
  });
});
