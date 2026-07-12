import { describe, expect, it } from "vitest";
import { initialsFromDisplayName } from "./display-name";

// 006 EARS-15 — the header-avatar initials derive from the REAL saved display
// name: first letter of the first word + first letter of the last word,
// uppercased; a single-word name yields a single initial. Never fabricated from
// an email/placeholder — with no saved name the page renders no avatar at all, so
// this pure helper is only ever handed a real, non-empty name (the empty-string
// row pins the defensive floor). Surrogate-safe (grapheme, not UTF-16 unit) and
// Cyrillic-correct (`.toUpperCase()`).
describe("006 EARS-15 initialsFromDisplayName — first+last initials from the real name", () => {
  it("EARS-15: two words «Иван Петров» → «ИП»", () => {
    expect(initialsFromDisplayName("Иван Петров")).toBe("ИП");
  });

  it("EARS-15: a single word «Иван» → the one initial «И»", () => {
    expect(initialsFromDisplayName("Иван")).toBe("И");
  });

  it("EARS-15: surrounding + interior whitespace «  Иван   Петров  » → «ИП»", () => {
    expect(initialsFromDisplayName("  Иван   Петров  ")).toBe("ИП");
  });

  it("EARS-15: three words «Анна Мария Иванова» → first + LAST → «АИ»", () => {
    expect(initialsFromDisplayName("Анна Мария Иванова")).toBe("АИ");
  });

  it("EARS-15: lowercase «иван петров» is uppercased → «ИП»", () => {
    expect(initialsFromDisplayName("иван петров")).toBe("ИП");
  });

  it("EARS-15: an empty / whitespace-only name yields no initials", () => {
    expect(initialsFromDisplayName("")).toBe("");
    expect(initialsFromDisplayName("   ")).toBe("");
  });
});
