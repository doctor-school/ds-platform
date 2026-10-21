/**
 * Playwright `httpCredentials` for a storefront live-tier config pointed at a
 * staging slot (#3168). Every slot hostname sits behind ONE basic-auth pair
 * (`tools/staging/README.md`), handed over as `E2E_HTTP_USER` / `E2E_HTTP_PASS`
 * by `pnpm e2e:stage` — the same names `packages/e2e/playwright.config.ts` and
 * `apps/portal/playwright.config.ts` read. As `use.httpCredentials` it answers
 * the challenge on every request the browser and the `request` fixture make,
 * the app's own same-origin `/v1/*` fetches included. Absent (a local dev
 * stand), it is `undefined` and nothing changes.
 */
export function standHttpCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { username: string; password: string } | undefined {
  const username = env.E2E_HTTP_USER;
  const password = env.E2E_HTTP_PASS;
  return username && password ? { username, password } : undefined;
}
