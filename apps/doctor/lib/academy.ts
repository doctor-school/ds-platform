/**
 * The Academy origin is the ONE cross-host crossing the doctor storefront is
 * allowed to make (LD-4). It lives here so every host surface that needs it —
 * the storefront footer, the `/login` password-recovery link — points at the
 * same origin instead of re-hardcoding a URL per component.
 */
export const ACADEMY_ORIGIN = "https://academy.doctor.school";

/**
 * Absolute Academy URL for a host-relative `path` (leading slash required).
 * `academyHref("/")` yields the bare origin with a trailing slash.
 */
export function academyHref(path: string): string {
  return `${ACADEMY_ORIGIN}${path}`;
}
