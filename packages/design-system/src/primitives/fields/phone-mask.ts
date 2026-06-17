/**
 * Phone input mask (#192), co-located with `<PhoneField>` (#197).
 *
 * Coerces free-typing into an E.164-valid `+<digits>` string as the user types, so
 * the stored form value is always submit-shaped (no spaces — `E164` forbids them)
 * and a phone channel can only ever hold a phone.
 *
 *  - Empty stays empty (lets the required/format error fire, not a stray `+`).
 *  - A domestic-length (11-digit) leading `8` (the common RU domestic prefix) and a
 *    leading bare `7` are both rewritten to the `+7` country code, so `89991234567` /
 *    `79991234567` → `+79991234567`. The `8→7` rewrite is gated to 11 digits so a
 *    pasted international `8…` number of another length is not mangled.
 *  - Any other input is normalised to `+` followed by its digits, capped at the
 *    E.164 maximum of 15 digits.
 *
 * Display grouping (spaces) is intentionally NOT applied to the stored value; the
 * placeholder (`+7…`) communicates the expected shape without desyncing the value
 * from what the BFF receives.
 */
export function maskPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits === "" && !raw.startsWith("+")) return "";

  let normalized = digits;
  // RU domestic `8…` → `7…`, but ONLY for a domestic-length (11-digit) number, so a
  // pasted international number that starts with `8` and is NOT 11 digits (e.g. a
  // 12-digit `+81 90…` Japan mobile) is not corrupted into `+71…`. An international
  // number that is itself exactly 11 digits starting with `8` is genuinely
  // indistinguishable from a RU domestic number under this length heuristic and still
  // reads as `+7…` — an accepted limit. A bare leading `7` is already the country code.
  if (normalized.length === 11 && normalized.startsWith("8")) {
    normalized = `7${normalized.slice(1)}`;
  }
  return `+${normalized.slice(0, 15)}`;
}
