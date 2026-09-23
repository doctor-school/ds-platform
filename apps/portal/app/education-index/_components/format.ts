/**
 * 045 — Russian number formatting for the education-index demo pages, as the
 * canvas `academy-index-demo.dc.html` renders it (`fmt`, `pc`, `plural`,
 * l.576–578): thousands grouped by a space, a decimal comma, and the three-form
 * Russian plural. Temporary demo helpers, deleted with 032/035 (EARS-14).
 */

/** 2040000 → «2 040 000». */
export function formatThousands(n: number): string {
  const digits = String(n);
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += " ";
    out += digits[i];
  }
  return out;
}

/** 1.5 → «1,5%». */
export function formatPercent(n: number): string {
  return `${String(n).replace(".", ",")}%`;
}

/** Russian plural: 1 урок, 2 урока, 5 уроков. */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const tens = n % 10;
  const hundreds = n % 100;
  if (tens === 1 && hundreds !== 11) return one;
  if (tens >= 2 && tens <= 4 && (hundreds < 12 || hundreds > 14)) return few;
  return many;
}
