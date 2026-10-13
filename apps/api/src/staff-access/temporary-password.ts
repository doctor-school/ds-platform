import { randomInt } from "node:crypto";

/**
 * 047 EARS-6 — the temporary password a grant sets on an account that has none,
 * by the admin-onboarding runbook's rule (047-design §Grant cascade): 16
 * characters from an unambiguous alphabet (no `0 O o 1 l I`), at least one
 * upper-case letter, one lower-case letter and one digit, and exactly one symbol
 * from `-_!@#%` that is never the first or last character. Every character comes
 * from `crypto.randomInt`.
 *
 * The value lives in the request scope and the `201` body only — never a log
 * line, an audit field or a column.
 */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "-_!@#%";
const ALNUM = UPPER + LOWER + DIGITS;

export const TEMPORARY_PASSWORD_LENGTH = 16;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

export function generateTemporaryPassword(): string {
  for (;;) {
    const chars = Array.from({ length: TEMPORARY_PASSWORD_LENGTH - 1 }, () =>
      pick(ALNUM),
    );
    const body = chars.join("");
    if (
      ![UPPER, LOWER, DIGITS].every((set) =>
        [...body].some((c) => set.includes(c)),
      )
    ) {
      continue;
    }
    // Positions 1 … length-2 of the final string: never at either end.
    const at = randomInt(1, TEMPORARY_PASSWORD_LENGTH - 1);
    chars.splice(at, 0, pick(SYMBOLS));
    return chars.join("");
  }
}
