/**
 * `maskDestination` (#227) — a pure helper that turns the destination a one-time
 * code was sent to (an email address or an E.164 phone) into a privacy-masked
 * confirmation string for the OTP focus-screen ("Код отправлен на …"). It lives in
 * `@ds/design-system` next to `<OtpFocusScreen>` so the app can compute the same
 * mask it would display and reuse it elsewhere (e.g. an aria-label).
 *
 * It NEVER throws and never reveals more than the first/last few characters:
 *
 *   • Email `a@p•••.com`     — first char of the local part, then the masked
 *     domain keeping its first char + TLD. Examples:
 *       `anna@preencipium.com`  → `a•••@p•••.com`
 *       `ab@x.io`               → `a•••@x•••.io`
 *   • Phone `+7•••••31223`     — country/leading digits + bullets + the last 4–5
 *     digits, so the owner recognises it but a shoulder-surfer cannot read it.
 *       `+79991231223`          → `+7•••••31223`
 *   • Anything else           — a generic centre-mask keeping the first and last
 *     character, so an unexpected value still renders safely.
 *
 * It is presentation-only: validation/shape is the field primitives' job. The
 * exact bullet count is cosmetic and intentionally fixed (not value-length-derived)
 * so the mask itself does not leak the destination's length.
 */

const BULLETS = "•••";

function maskEmail(value: string): string {
  const at = value.indexOf("@");
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const localHead = local.slice(0, 1) || "";
  if (dot <= 0) {
    // No TLD separator — mask the whole domain after its first char.
    return `${localHead}${BULLETS}@${domain.slice(0, 1)}${BULLETS}`;
  }
  const tld = domain.slice(dot); // includes the leading dot, e.g. ".com"
  const domainHead = domain.slice(0, 1);
  return `${localHead}${BULLETS}@${domainHead}${BULLETS}${tld}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  // Keep a leading `+`, the first 1–2 digits (country code-ish) and the last 5.
  const lead = value.startsWith("+") ? "+" : "";
  const head = digits.slice(0, value.startsWith("+") ? 1 : 2);
  const tail = digits.slice(-5);
  return `${lead}${head}•••••${tail}`;
}

function maskGeneric(value: string): string {
  if (value.length <= 2) return `${value.slice(0, 1)}${BULLETS}`;
  return `${value.slice(0, 1)}${BULLETS}${value.slice(-1)}`;
}

/**
 * Mask a code destination for display. Pure, total (never throws), and
 * presentation-only — pass the raw email / E.164 phone the code was sent to.
 */
export function maskDestination(value: string): string {
  const v = (value ?? "").trim();
  if (v === "") return "";
  if (v.includes("@")) return maskEmail(v);
  // E.164 phone: a leading `+` or an all-digit string.
  if (/^\+?\d{4,}$/.test(v.replace(/[\s()-]/g, ""))) return maskPhone(v);
  return maskGeneric(v);
}
