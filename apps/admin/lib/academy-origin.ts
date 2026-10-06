/**
 * The Academy public origin the admin links to (#2619).
 *
 * Admin «Публичная ссылка» on a project, partner or expert opens the record on
 * the Academy storefront. The origin is CONFIGURATION, read at request time
 * from `ACADEMY_PUBLIC_ORIGIN` (the root layout resolves it on the server and
 * hands it to the client tree): production `https://academy.doctor.school`
 * (`/etc/ds-platform/api.env`), a stage slot its own `academy-<slot>.…` host
 * (`tools/staging/slot.mjs` → the per-slot env file), the local stand its
 * portal (`apps/admin/.env.example`). A runtime value — not `NEXT_PUBLIC_*` —
 * because slot images are built once per commit and shared by every slot on
 * that commit, so a build-time host would leak one slot's origin into another.
 *
 * There is deliberately NO production fallback: a missing or malformed value
 * refuses, so a misconfigured environment fails visibly instead of silently
 * linking to production.
 */
export const ACADEMY_PUBLIC_ORIGIN_ENV = "ACADEMY_PUBLIC_ORIGIN";

export type AcademyPublicSection = "projects" | "partners" | "experts";

export function readAcademyOrigin(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const raw = (env[ACADEMY_PUBLIC_ORIGIN_ENV] ?? "").trim();
  if (!raw) {
    throw new Error(
      `${ACADEMY_PUBLIC_ORIGIN_ENV} is not set — the admin needs the Academy public origin (e.g. https://academy.doctor.school)`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${ACADEMY_PUBLIC_ORIGIN_ENV}=${JSON.stringify(raw)} is not an absolute URL`,
    );
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `${ACADEMY_PUBLIC_ORIGIN_ENV}=${JSON.stringify(raw)} must be a bare http(s) origin such as https://academy.doctor.school`,
    );
  }
  return url.origin;
}

export function academyPublicUrl(
  origin: string,
  section: AcademyPublicSection,
  slug: string,
): string {
  return `${origin}/${section}/${encodeURIComponent(slug)}`;
}
