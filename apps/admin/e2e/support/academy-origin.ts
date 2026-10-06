import {
  academyPublicUrl,
  readAcademyOrigin,
  type AcademyPublicSection,
} from "../../lib/academy-origin";

/**
 * The expected prefix of an admin «Публичная ссылка» (#2619).
 *
 * The admin links to the Academy origin it is CONFIGURED with
 * (`ACADEMY_PUBLIC_ORIGIN`), so a spec asserting that link derives the origin
 * from the same variable through the same reader — never a pinned production
 * host. A runner that boots the admin with the value but leaves it out of the
 * Playwright process fails here with the reader's explicit error, not with a
 * URL mismatch.
 */
export function academyPublicLinkPrefix(
  section: AcademyPublicSection,
  slugPrefix: string,
): string {
  return academyPublicUrl(readAcademyOrigin(process.env), section, slugPrefix);
}
