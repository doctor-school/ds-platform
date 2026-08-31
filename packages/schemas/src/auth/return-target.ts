/**
 * 014 EARS-6 — the PLATFORM-WIDE return-to-origin guard (014 design §6).
 *
 * The owner's rule (2026-08-17) is broader than any one feature: whenever content
 * sits behind a login, the visitor who authenticates from that gate is landed
 * back on the exact page they were trying to consume. 014 design §6 implements
 * that rule ONCE, as a portal-auth mechanism, and 014's own gated surfaces are
 * its first consumer; this module is the framework-agnostic SSOT (ADR-0002 §3)
 * for the only question the mechanism must never get wrong — is this carried
 * target safe to navigate to?
 *
 * Relationship to the 005 registration-intent guard (`registration-intent.ts`):
 * that guard is deliberately narrower — it admits ONLY `/webinars/<slug>`, because
 * a value it accepts also fires `RegisterForEvent` for that slug. It keeps that
 * job. This module is the platform-wide SUPERSET used for every OTHER gated
 * surface, and by construction accepts everything the narrow guard accepts, so the
 * platform never runs two competing redirect policies (pinned by
 * `apps/api/test/auth/return-target.e2e-spec.ts`, EARS-6.7).
 *
 * The accept side is narrow on purpose: an absolute URL, a protocol-relative
 * `//host`, a backslash-escaped variant and a path escaping the app are each
 * DROPPED in favour of the surface's default landing. The mechanism must never
 * become an open redirect.
 */

/**
 * The longest carried target the guard will consider. A return target is a page
 * path on this origin; anything past this is not a real route but a payload, and
 * is rejected before any decoding work happens.
 */
export const MAX_RETURN_TARGET_LENGTH = 512;

/**
 * Characters that never belong in a same-origin path and are classic redirect
 * bypasses: any C0 control character or space (a raw tab/newline is stripped by
 * browsers when parsing a URL, so a `/<TAB>/evil` can re-form as `//evil`), DEL,
 * and the backslash (browsers may read `/\evil` as `//evil`). Their presence
 * anywhere in the value rejects the WHOLE value rather than being sanitised away
 * — a sanitising guard is exactly how bypasses are found.
 *
 * Written as a scan rather than a regular expression on purpose: the character
 * class would have to embed literal control characters in this source file.
 */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
    if (value[i] === "\\") return true;
  }
  return false;
}

/**
 * Parse a raw carried `returnTo` into the canonical same-origin path to land on,
 * or `null` when it is not safe to follow. `null` is not an error — it is the
 * instruction to use the surface's default landing instead (014 design §6: a
 * default, never an override of a present valid target).
 *
 * Accepted: an absolute-path reference on this origin — a leading `/`, no scheme,
 * no authority, no traversal, no empty inner segment. Percent-encoded segments are
 * decoded ONCE for validation and the ORIGINAL encoding is preserved in the
 * returned value, so a legitimately encoded slug survives the round-trip intact.
 *
 * Rejected (→ `null`): a non-string, an empty or over-long value; an absolute URL
 * (`https://evil`, `javascript:`, `data:`); a protocol-relative `//host`; any
 * backslash, control character or space; a path escaping the app (`..`, `.`,
 * including their percent-encoded forms); an empty inner segment that re-forms
 * `//`; and a malformed percent-escape.
 *
 * The returned target carries NO query and NO fragment. The return target is a
 * page, not page state, and dropping both removes redirect chaining outright: the
 * page a visitor is landed on can never be handed an attacker-authored `?next=`
 * to follow onward.
 */
export function parseSameOriginReturnTarget(returnTo: unknown): string | null {
  if (typeof returnTo !== "string") return null;
  if (returnTo.length === 0 || returnTo.length > MAX_RETURN_TARGET_LENGTH) {
    return null;
  }
  if (hasUnsafeChar(returnTo)) return null;

  // An absolute-path reference only: one leading slash, never two (a leading `//`
  // is a protocol-relative URL and would leave the origin).
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return null;

  // Strip the fragment, then the query — neither survives into the canonical
  // target (see the doc comment above).
  const hashAt = returnTo.indexOf("#");
  const withoutHash = hashAt === -1 ? returnTo : returnTo.slice(0, hashAt);
  const queryAt = withoutHash.indexOf("?");
  const path = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  if (path.length === 0 || !path.startsWith("/")) return null;
  // A scheme can only appear here if the path itself smuggles one.
  if (path.includes(":")) return null;

  // Decode ONCE to unmask an encoded separator or traversal (`%2f`, `%2e%2e`); a
  // malformed escape is itself a reject rather than a best-effort salvage.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (hasUnsafeChar(decoded)) return null;
  // After decoding, an empty inner segment would re-form `//` (protocol-relative
  // once the browser resolves it) — reject it anywhere in the path.
  if (decoded.includes("//")) return null;
  if (decoded.includes(":")) return null;
  // No segment may escape the app.
  for (const segment of decoded.split("/")) {
    if (segment === "." || segment === "..") return null;
  }

  // Return the ORIGINAL (still-encoded) path, not the decoded form: it is now
  // proven to be a same-origin absolute-path reference, and re-emitting the
  // decoded text would corrupt a legitimately encoded segment.
  return path;
}

/** `true` iff `returnTo` is a safe same-origin return target (014 EARS-6). */
export function isSafeSameOriginReturnTarget(returnTo: unknown): boolean {
  return parseSameOriginReturnTarget(returnTo) !== null;
}
