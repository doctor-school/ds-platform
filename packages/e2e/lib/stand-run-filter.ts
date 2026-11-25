/**
 * The scenario filter `pnpm e2e:stage` hands every storefront live-tier config
 * (#4096). `tools/staging/e2e-stage.mjs` puts `--grep` into the env as `E2E_GREP`
 * and the box-observing exclusion as `E2E_GREP_INVERT` (#4202). It uses the env
 * rather than a `--grep` argv element because it runs `pnpm` through a shell (the
 * `.cmd` shims on Windows), which would parse an ordinary alternation such as
 * `"вход|выход"` as a pipeline; nothing parses an env var.
 *
 * Spread into a live-tier `defineConfig`. A leg narrowed by `--grep` then runs only
 * the matching tests, and a targeted single-test run against a slot does not drag
 * every live leg through in full. `packages/e2e/playwright.config.ts` reads the same
 * two names for the main suite. Neither set → `{}`: a full run selects every test.
 */
export function standRunFilter(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { grep?: RegExp; grepInvert?: RegExp } {
  return {
    ...(env.E2E_GREP ? { grep: new RegExp(env.E2E_GREP) } : {}),
    ...(env.E2E_GREP_INVERT
      ? { grepInvert: new RegExp(env.E2E_GREP_INVERT) }
      : {}),
  };
}
