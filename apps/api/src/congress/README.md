# `congress` — the public congress sign-up intake (feature 044)

One unauthenticated command, `POST /v1/congress/sign-up`, through which a doctor
signs up for the congress on the congress site and gets a registration for the
congress event plus a personal-data consent row, in one cascade — together with
a new platform account when the address is unknown, or attached to the account
the address already has, with the same response either way.

Spec: `apps/docs/content/specs/features/044-congress-signup/`.

## What lives here

| File                         | Role                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `congress-signup.controller` | The public route and the protections it carries (`@Public`, `@BotProtected`, `@RateLimited` under the intake's own scope, `@TimingEqualized`). |
| `congress-signup.service`    | The order of the checks and the one transaction the accepted path writes in.                                                                   |
| `congress-signup.config`     | The registration window (code constants) and the two configured settings, validated.                                                           |
| `congress-signup.tokens`     | The injected clock and the per-request configuration reader.                                                                                   |
| `congress-signup.dto`        | The nestjs-zod adapter over the `@ds/schemas` SSOT.                                                                                            |

## What this module deliberately does NOT own

- **Account creation.** `AuthService.createPasswordlessAccount` (003) does it,
  including the IdP call, the `users` mirror, the role grant and the ledger row —
  and, when the address is already known, the resolution of the existing mirror
  row (never a profile write). This module supplies the ONE callback that both
  paths run inside that method's transaction, which is what makes the cascade
  atomic and what makes the two paths indistinguishable by construction.
- **The captcha.** `@BotProtected` marks the route; the provider, the threshold
  and the verdict are the 003 bot-protection module's.
- **The event's lifecycle.** The intake reads the configured event and refuses
  unless it is registrable; authoring and transitions belong to feature 007.

## Configuration

All three keys are validated at request time and a missing or malformed value
refuses the intake generically — the endpoint never runs with a half-configured meaning.

| Env key                           | Meaning                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONGRESS_SIGNUP_EVENT_ID`        | The uuid of the congress event every submission is registered for.                                                                                                                                |
| `CONGRESS_SIGNUP_CONSENT_VERSION` | `YYYY-MM-DD.sha256-<64 hex>` — publication date + digest of the published personal-data text (ADR-0009 §2.1). Stamped by the server; never taken from the caller.                                 |
| `CONGRESS_SIGNUP_TIMING_FLOOR_MS` | Optional. Whole milliseconds the intake response is padded to, so the new-account and existing-account branches take the same time on the wire (EARS-7). Unset ⇒ the conservative default `1000`. |

**Calibrating the timing floor.** The floor only equalises the two branches if it
exceeds the SLOWER one — the new-account path, which creates a user in the IdP
and commits the whole transaction. The shipped default of one second is
deliberately conservative rather than measured; the operator rule is to set this
key to at least the p99 of that path as observed on production and to re-check it
after any change to the IdP or the intake transaction. Overshooting costs a
slower congress form; undershooting reopens the «does this address already have
an account?» oracle the floor exists to close. It is read per request, so a
raised floor needs no redeploy; a value that is not whole milliseconds refuses
the intake rather than silently reverting to the default.

The registration window is NOT configuration: both instants are code constants
in `congress-signup.config.ts`, because the window is a product decision
recorded in the spec rather than an operator knob.

## Slice state

Both intake paths are live: a NEW email gets an account created for it, and an
email the platform already knows has the registration attached to the account it
already has, with no profile field rewritten and the same `accepted` response.
Repeat submissions write no second registration and no second consent row at the
same published version.

Still to land: the confirmation email the success state promises (#2304 / #2305
/ #2306). Until it does, the response says the submission was accepted and the
mail itself is not dispatched.
