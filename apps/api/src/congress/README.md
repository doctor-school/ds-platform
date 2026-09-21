# `congress` — the public congress sign-up intake (feature 044)

One unauthenticated command, `POST /v1/congress/sign-up`, through which a doctor
signs up for the congress on the congress site and — if the platform does not
know the address yet — gets a platform account, a registration for the congress
event and a personal-data consent row, all in one cascade.

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
  including the IdP call, the `users` mirror, the role grant and the ledger row.
  This module supplies the callback that writes the registration and the consent
  row inside that method's transaction, which is what makes the cascade atomic.
- **The captcha.** `@BotProtected` marks the route; the provider, the threshold
  and the verdict are the 003 bot-protection module's.
- **The event's lifecycle.** The intake reads the configured event and refuses
  unless it is registrable; authoring and transitions belong to feature 007.

## Configuration

Both keys are validated at request time and a missing or malformed value refuses
the intake generically — the endpoint never runs with a half-configured meaning.

| Env key                           | Meaning                                                                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONGRESS_SIGNUP_EVENT_ID`        | The uuid of the congress event every submission is registered for.                                                                                                |
| `CONGRESS_SIGNUP_CONSENT_VERSION` | `YYYY-MM-DD.sha256-<64 hex>` — publication date + digest of the published personal-data text (ADR-0009 §2.1). Stamped by the server; never taken from the caller. |

The registration window is NOT configuration: both instants are code constants
in `congress-signup.config.ts`, because the window is a product decision
recorded in the spec rather than an operator knob.

## Slice state

This module currently implements the NEW-email path. A submission from an
address the platform already knows is refused generically and writes nothing;
the real existing-account behaviour lands with #2299 / #2300 / #2301, and the
confirmation email with #2304 / #2305 / #2306.
