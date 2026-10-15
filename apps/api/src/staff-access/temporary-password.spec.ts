import { describe, expect, it } from "vitest";
import {
  TEMPORARY_PASSWORD_LENGTH,
  generateTemporaryPassword,
} from "./temporary-password.js";

describe("047 temporary password", () => {
  it("047 EARS-6: 16 unambiguous characters, every class, one inner symbol", () => {
    for (let i = 0; i < 500; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
      expect(pw).not.toMatch(/[0Oo1lI]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[2-9]/);
      const symbols = pw.match(/[-_!@#%]/g) ?? [];
      expect(symbols).toHaveLength(1);
      expect(pw[0]).toMatch(/[A-Za-z2-9]/);
      expect(pw[pw.length - 1]).toMatch(/[A-Za-z2-9]/);
    }
  });

  it("047 EARS-6: two passwords differ", () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });
});
