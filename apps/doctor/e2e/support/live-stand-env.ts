import { test } from "@playwright/test";

/**
 * Live-stand env gate for the 006 room browser tier on the DOCTOR host (#1912,
 * #1722 slice 4).
 *
 * This is the doctor twin of `apps/portal/e2e/support/live-stand-env.ts`. It is a
 * deliberate DUPLICATE rather than a shared import: `apps/doctor` may not import
 * from `apps/portal` (ADR-0013 A1 — app-to-app imports are forbidden, and 020
 * EARS-15 host purity), and the shared room package (`packages/room`) is Next-free
 * PRODUCT code, not a home for Playwright test scaffolding. The duplication is
 * recorded in `DEBT.md`: a THIRD e2e host, or a second edit to either copy, is the
 * trigger to hoist both into a workspace e2e-support package.
 *
 * The room specs are dev-stand-gated: they drive a REAL doctor storefront + api +
 * Postgres + Zitadel + Mailpit, so a bare CI runner cannot execute them. The
 * historical gate was a bare `test.skip(!LIVE_STAND, …)`, which is correct for CI
 * but ROTS silently on the stand: one un-exported variable turned a whole suite
 * into green SKIPs, so stale selectors and stale preconditions survived for
 * releases (PR #1870 observed 4 FAILs behind 19 silent SKIPs).
 *
 * This module splits the two cases that skip used to conflate:
 *
 * - **bare CI** — NONE of `E2E_DOCTOR_URL` / `IDP_ISSUER` / `MAILPIT_URL` is set
 *   and no `E2E_ROOM_*` / `E2E_DOCTOR*` var is exported: the tier was never
 *   intended, so it stays inert-green via `test.skip`.
 * - **intended but incomplete** — the operator exported SOME of the tier's env
 *   (so the run was meant to happen) but a required variable is missing: fail
 *   LOUDLY in `beforeAll`, naming every missing variable, instead of skipping.
 * - **complete** — every declared variable is present: the spec runs.
 *
 * `--list` stays green in all three states (the throw lives in `beforeAll`, not
 * at module scope), so the CI `playwright test --list` gate is unaffected.
 *
 * STAND PRECONDITIONS (#1912) — this gate covers the ENV SET only. The STAND itself
 * carries two further preconditions (repeated in every spec docblock, canonical
 * here); unmet, the tier fails against a CORRECT product render:
 *
 * - **Saved display name.** The REUSED account (`E2E_DOCTOR_EMAIL` /
 *   `E2E_DOCTOR_PASSWORD`) must already have a display name saved. Without one,
 *   006 EARS-14's JIT name prompt renders INSTEAD of the room composition and
 *   every in-room assertion fails. The doctor host mints its session through the
 *   api (`support/doctor-session.ts`) rather than through a signup form, so the
 *   name cannot be satisfied inline — it is a stand precondition here, always.
 * - **Raised rate-limit ceilings.** Boot the api with
 *   `RATE_LIMIT_PER_USER_15MIN=1000`, `RATE_LIMIT_PER_IP_15MIN=2000` and
 *   `RATE_LIMIT_PER_ASN_1H=5000`. The 003 EARS-13 defaults (10 per user per
 *   15 min, 20 per IP) are an order of magnitude below the logins one serial run
 *   of this tier drives from a single IP: at the defaults the suite hard-429s
 *   mid-run and every login-based test dies. These ceilings are env-overridable
 *   BY DESIGN for exactly this window (#1076,
 *   `apps/api/src/auth/rate-limit/rate-limit.types.ts`).
 */

/** The three variables that together mean "a live stand is reachable". */
export const LIVE_STAND_VARS = [
  "E2E_DOCTOR_URL",
  "IDP_ISSUER",
  "MAILPIT_URL",
] as const;

/** The heartbeat cadence ceiling a room presence spec can observe in-window. */
export const HEARTBEAT_SECONDS_MAX = 10;

const isSet = (name: string): boolean => !!process.env[name]?.trim();

/**
 * True when the operator INTENDED this tier to run: either the live stand is
 * declared, or any room/doctor fixture variable was exported. Only a completely
 * bare environment (CI) is treated as "not intended".
 */
export function liveStandTierIntended(): boolean {
  if (LIVE_STAND_VARS.some(isSet)) return true;
  return Object.keys(process.env).some(
    (key) => /^E2E_(ROOM_|DOCTOR|CHAT_)/.test(key) && isSet(key),
  );
}

const bareCiReason = (): string =>
  `006 room live-stand tier inert — none of ${LIVE_STAND_VARS.join(" / ")} is set (bare CI). See the env-set docblock at the head of this spec.`;

/** Register a `beforeAll` that fails the whole file with a named-variable error. */
function failLoudly(message: string): void {
  test.beforeAll(() => {
    throw new Error(message);
  });
}

/**
 * Declare the FULL env set a spec file needs. Call once at file scope, above the
 * describes.
 *
 * Bare CI → `test.skip` (inert green). Tier intended but a variable missing →
 * `beforeAll` throws naming every missing variable. Complete → no-op.
 */
export function requireLiveStandEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !isSet(name));
  if (missing.length === 0) return;
  if (!liveStandTierIntended()) {
    test.skip(true, bareCiReason());
    return;
  }
  failLoudly(
    `006 room live-stand tier was INTENDED (some E2E_* env is exported) but is INCOMPLETE — missing env: ${missing.join(", ")}. Export the full set listed in the docblock at the head of this spec, or unset every E2E_*/IDP_ISSUER/MAILPIT_URL variable to run inert.`,
  );
}

/**
 * Heartbeat cadence precondition (#1912). The room presence loop beats every N
 * seconds where N is SERVER config (`ROOM_HEARTBEAT_INTERVAL_SECONDS`, api
 * default 60) delivered in the grant; the spec waits multiples of the value it
 * reads from `E2E_ROOM_HEARTBEAT_SECONDS`. With the api left on its 60 s default
 * those waits exceed the Playwright timeout and the tests died as opaque
 * timeouts. Require the variable explicitly and cap it, so the mismatch is
 * reported by NAME instead.
 *
 * Returns the cadence in seconds (the historical `2` default when the tier is
 * inert, so module-scope arithmetic stays finite).
 */
export function requireShortHeartbeat(): number {
  const raw = process.env.E2E_ROOM_HEARTBEAT_SECONDS;
  const seconds = Number(raw ?? "2");
  const valid = Number.isFinite(seconds) && seconds > 0;
  if (valid && seconds <= HEARTBEAT_SECONDS_MAX) return seconds;
  if (!liveStandTierIntended()) {
    test.skip(true, bareCiReason());
    return 2;
  }
  failLoudly(
    `E2E_ROOM_HEARTBEAT_SECONDS is "${raw}" — it must be a positive number ≤ ${HEARTBEAT_SECONDS_MAX}. The api under test must be booted with the matching ROOM_HEARTBEAT_INTERVAL_SECONDS (its default 60 makes these waits exceed the Playwright timeout).`,
  );
  return valid ? seconds : 2;
}
