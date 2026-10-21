import { test } from "@playwright/test";

/**
 * Live-stand env gate for the 006 room browser tier — ONE gate for both
 * storefront hosts (#1871 portal, #1912 doctor; hoisted here by #2073 wave-4
 * gate D6). Each host binds it once in its own `e2e/support/live-stand-env.ts`
 * with the variable that names its storefront (`E2E_PORTAL_URL` /
 * `E2E_DOCTOR_URL`); the specs import that binding.
 *
 * The room specs are dev-stand-gated: they drive a REAL storefront + api +
 * Postgres + Zitadel + Mailpit, so a bare CI runner cannot execute them. The
 * historical gate was a bare `test.skip(!LIVE_STAND, …)`, which is correct for
 * CI but ROTS silently on the stand: one un-exported variable turned a whole
 * suite into green SKIPs, so stale selectors and stale preconditions survived
 * for releases (PR #1870 observed 4 FAILs behind 19 silent SKIPs).
 *
 * This module splits the two cases that skip used to conflate:
 *
 * - **bare CI** — NONE of the host URL variable / `IDP_ISSUER` / `MAILPIT_URL`
 *   is set and no `E2E_ROOM_*` / `E2E_DOCTOR*` / `E2E_CHAT_*` var is exported:
 *   the tier was never intended, so it stays inert-green via `test.skip`.
 * - **intended but incomplete** — the operator exported SOME of the tier's env
 *   (so the run was meant to happen) but a required variable is missing: fail
 *   LOUDLY in `beforeAll`, naming every missing variable, instead of skipping.
 * - **complete** — every declared variable is present: the spec runs.
 *
 * `--list` stays green in all three states (the throw lives in `beforeAll`, not
 * at module scope), so the CI `playwright test --list` gate is unaffected.
 *
 * STAND PRECONDITIONS — this gate covers the ENV SET only. The STAND itself
 * carries two further preconditions (repeated in every spec docblock, canonical
 * here); unmet, the tier fails against a CORRECT product render:
 *
 * - **Saved display name.** Any REUSED account (`E2E_DOCTOR_*` /
 *   `E2E_DOCTOR2_*`) must already have a display name saved. Without one, 006
 *   EARS-14's JIT name prompt renders INSTEAD of the room composition and every
 *   in-room assertion fails. On the Academy, specs that self-sign-up a fresh
 *   doctor satisfy that prompt inline; the doctor host mints its session through
 *   the api (`support/doctor-session.ts`), so there it is a stand precondition,
 *   always.
 * - **Raised rate-limit ceilings.** Boot the api with
 *   `RATE_LIMIT_PER_USER_15MIN=1000`, `RATE_LIMIT_PER_IP_15MIN=2000` and
 *   `RATE_LIMIT_PER_ASN_1H=5000`. The 003 EARS-13 defaults (10 per user per
 *   15 min, 20 per IP) are an order of magnitude below the logins one serial run
 *   of this tier drives from a single IP: at the defaults the suite hard-429s
 *   mid-run and every login-based test dies. These ceilings are env-overridable
 *   BY DESIGN for exactly this window (#1076,
 *   `apps/api/src/auth/rate-limit/rate-limit.types.ts`).
 */

/** The heartbeat cadence ceiling a room presence spec can observe in-window. */
export const HEARTBEAT_SECONDS_MAX = 10;

/** What a host binds the gate with. */
export interface LiveStandHost {
  /** The variable naming this host's storefront URL (`E2E_PORTAL_URL`, …). */
  readonly urlVar: string;
  /**
   * How the heartbeat refusal names the Playwright timeout the default cadence
   * overruns — the host's own wording, kept verbatim.
   */
  readonly playwrightTimeout: string;
}

/** The gate one host's specs call. */
export interface LiveStandGate {
  /** The three variables that together mean "a live stand is reachable". */
  readonly LIVE_STAND_VARS: readonly [string, "IDP_ISSUER", "MAILPIT_URL"];
  liveStandTierIntended(): boolean;
  requireLiveStandEnv(names: readonly string[]): void;
  requireShortHeartbeat(): number;
}

const isSet = (name: string): boolean => !!process.env[name]?.trim();

/**
 * 044 (#3149) — the api keys the public congress intake refuses every
 * submission without (`apps/api/src/congress/congress-signup.config.ts`):
 * unset, the sign-up answers the one generic 422 and only the api log says
 * why. `CONGRESS_SIGNUP_TIMING_FLOOR_MS` is absent on purpose — unset, it
 * falls back to its default and refuses nothing.
 */
export const CONGRESS_SIGNUP_STAND_VARS = [
  "CONGRESS_SIGNUP_EVENT_ID",
  "CONGRESS_SIGNUP_CONSENT_VERSION",
  "CONGRESS_SIGNUP_WINDOW_OPENS_AT",
  "CONGRESS_SIGNUP_WINDOW_CLOSES_AT",
  "CONGRESS_SIGNUP_EVENT_DAYS",
] as const;

/**
 * #3149 — why a live spec that drives a REAL congress sign-up cannot expect
 * «accepted» from this stand, or `null` when it can as far as the env shows.
 *
 * The runner reads the same `~/.ds-platform/.env.local` the api is booted
 * from (the stand recipe), so a key missing here is missing there, and the
 * spec names it instead of failing on an opaque 422.
 */
export function congressSignUpEnvProblem(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const missing = CONGRESS_SIGNUP_STAND_VARS.filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length === 0) return null;
  return (
    `the congress sign-up needs the api booted with ${missing.join(", ")} — ` +
    "unset, the intake refuses every submission with a generic 422. Copy the " +
    "block from infra/dev-stand/.env.example into ~/.ds-platform/.env.local, " +
    "seed the congress event (`pnpm --filter @ds/api seed:events`) and boot " +
    "the api and this runner from that file."
  );
}

/** Register a `beforeAll` that fails the whole file with a named-variable error. */
function failLoudly(message: string): void {
  test.beforeAll(() => {
    throw new Error(message);
  });
}

export function liveStandGate(host: LiveStandHost): LiveStandGate {
  const LIVE_STAND_VARS = [host.urlVar, "IDP_ISSUER", "MAILPIT_URL"] as const;

  /**
   * True when the operator INTENDED this tier to run: either the live stand is
   * declared, or any room/doctor fixture variable was exported. Only a
   * completely bare environment (CI) is treated as "not intended".
   */
  function liveStandTierIntended(): boolean {
    if (LIVE_STAND_VARS.some(isSet)) return true;
    return Object.keys(process.env).some(
      (key) => /^E2E_(ROOM_|DOCTOR|CHAT_)/.test(key) && isSet(key),
    );
  }

  const bareCiReason = (): string =>
    `006 room live-stand tier inert — none of ${LIVE_STAND_VARS.join(" / ")} is set (bare CI). See the env-set docblock at the head of this spec.`;

  /**
   * Declare the FULL env set a spec file needs. Call once at file scope, above
   * the describes.
   *
   * Bare CI → `test.skip` (inert green). Tier intended but a variable missing →
   * `beforeAll` throws naming every missing variable. Complete → no-op.
   */
  function requireLiveStandEnv(names: readonly string[]): void {
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
   * Heartbeat cadence precondition. The room presence loop beats every N
   * seconds where N is SERVER config (`ROOM_HEARTBEAT_INTERVAL_SECONDS`, api
   * default 60) delivered in the grant; the spec waits multiples of the value
   * it reads from `E2E_ROOM_HEARTBEAT_SECONDS`. With the api left on its 60 s
   * default those waits exceed the Playwright timeout and the tests died as
   * opaque timeouts. Require the variable explicitly and cap it, so the
   * mismatch is reported by NAME instead.
   *
   * Returns the cadence in seconds (the historical `2` default when the tier is
   * inert, so module-scope arithmetic stays finite).
   */
  function requireShortHeartbeat(): number {
    const raw = process.env.E2E_ROOM_HEARTBEAT_SECONDS;
    const seconds = Number(raw ?? "2");
    const valid = Number.isFinite(seconds) && seconds > 0;
    if (valid && seconds <= HEARTBEAT_SECONDS_MAX) return seconds;
    if (!liveStandTierIntended()) {
      test.skip(true, bareCiReason());
      return 2;
    }
    failLoudly(
      `E2E_ROOM_HEARTBEAT_SECONDS is "${raw}" — it must be a positive number ≤ ${HEARTBEAT_SECONDS_MAX}. The api under test must be booted with the matching ROOM_HEARTBEAT_INTERVAL_SECONDS (its default 60 makes these waits exceed ${host.playwrightTimeout}).`,
    );
    return valid ? seconds : 2;
  }

  return {
    LIVE_STAND_VARS,
    liveStandTierIntended,
    requireLiveStandEnv,
    requireShortHeartbeat,
  };
}
