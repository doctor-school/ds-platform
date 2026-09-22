# `congress` — the public congress sign-up intake (feature 044)

One unauthenticated command, `POST /v1/congress/sign-up`, through which a doctor
signs up for the congress on the congress site and gets a registration for the
congress event plus a personal-data consent row, in one cascade — together with
a new platform account when the address is unknown, or attached to the account
the address already has, with the same response either way.

Spec: `apps/docs/content/specs/features/044-congress-signup/`.

## What lives here

| File                         | Role                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `congress-signup.controller` | The public route and the protections it carries (`@Public`, `@BotProtected`, `@RateLimited` under the intake's own scope, `@TimingEqualized`).   |
| `congress-signup.service`    | The order of the checks and the one transaction the accepted path writes in.                                                                     |
| `congress-signup.config`     | Every configured setting the intake needs — the event, the consent version, the venue, the registration window and the timing floor — validated. |
| `congress-signup.tokens`     | The injected clock and the per-request configuration reader.                                                                                     |
| `congress-signup.dto`        | The nestjs-zod adapter over the `@ds/schemas` SSOT.                                                                                              |

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

All six keys are validated at request time and a missing or malformed value
refuses the intake generically — the endpoint never runs with a half-configured meaning.

| Env key                            | Meaning                                                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONGRESS_SIGNUP_EVENT_ID`         | The uuid of the congress event every submission is registered for.                                                                                                                                                                                  |
| `CONGRESS_SIGNUP_CONSENT_VERSION`  | `YYYY-MM-DD.sha256-<64 hex>` — publication date + digest of the published personal-data text (ADR-0009 §2.1). Stamped by the server; never taken from the caller.                                                                                   |
| `CONGRESS_SIGNUP_EVENT_VENUE`      | The venue the confirmation email names («{место}», EARS-13). REQUIRED: a missing or blank value refuses every submission. There is no venue column on `events` — the venue is a constant of THIS congress.                                          |
| `CONGRESS_SIGNUP_WINDOW_OPENS_AT`  | REQUIRED (EARS-28). The instant the intake starts accepting submissions, ISO-8601 with an explicit offset (`2026-10-01T00:00:00.000+03:00` or `…Z`). An offset-less value is refused, never guessed. Echoed verbatim in the `not-yet-open` refusal. |
| `CONGRESS_SIGNUP_WINDOW_CLOSES_AT` | REQUIRED (EARS-28). The instant it stops, same format, strictly after the open. The closing instant is OUTSIDE the window (half-open interval).                                                                                                     |
| `CONGRESS_SIGNUP_TIMING_FLOOR_MS`  | Optional. Whole milliseconds the intake response is padded to, so the new-account and existing-account branches take the same time on the wire (EARS-7). Unset ⇒ the conservative default `1000`.                                                   |

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

**The registration window per environment.** Both instants are configuration
because they differ per environment: a dev stand or a stage slot needs a window
that is open right now for the intake to be exercisable at all, while production
carries the owner's real dates (the closing one is a launch input on #2292, and
the same instants the congress site displays). They are validated beside the
other 044 keys and fail CLOSED as a pair: unset, offset-less, unparseable or
closing-before-opening refuses the submission through the one generic refusal —
NOT through a window refusal, because a deployment with no opening instant
cannot honestly announce one. There is still no admin screen and no settings
row; making the window admin-editable is tracked separately (`DEBT.md`,
2026-09-21).

## Slice state

Both intake paths are live: a NEW email gets an account created for it, and an
email the platform already knows has the registration attached to the account it
already has, with no profile field rewritten and the same `accepted` response.
Repeat submissions write no second registration and no second consent row at the
same published version.

The confirmation email is live too. It is dispatched AFTER the transaction has
committed and is never awaited by the response: a slow or unreachable relay can
neither delay an accepted submission nor turn it into a refusal.

**Mail outcome, and why there is no retry queue.** The outcome is recorded on the
registration itself — `registrations.confirmation_mail_status` (`sent` |
`failed`) and `confirmation_mail_at`. `NULL` means no dispatch was ever
attempted for that row, which is what platform-origin registrations read. Before
sending, the dispatcher re-reads the row: a `sent` there ends it without touching
the mailer, so a participant who submits the form twice gets exactly one email.
A `failed` — or a `NULL` left by an interrupted attempt — dispatches again.

**Which paragraph the confirmation carries** is also a column, not a decision
taken at send time: `registrations.account_created_by_intake` records whether the
intake CREATED this participant's account, written inside the account
transaction and frozen at the first submission by the same `ON CONFLICT DO
NOTHING`. Reading it back is what makes a re-send identical to the send it
replaces — by the time a participant resubmits after a failure the account
exists, so a variant chosen from the current call would tell someone to sign in
to an account this very intake had just minted. `NULL` is the platform-origin
row, which is never dispatched to.

The `failed` outcome is written only while the row is not already `sent`, so two
overlapping dispatches cannot let a loser's rejection overwrite a winner's
success; a `sent` outcome is written unconditionally.

That re-read IS the whole recovery mechanism: there is no outbox, no scheduler
and no automatic retry. A participant whose mail failed recovers by submitting
the form again; a registrar sees the failed rows on the roster and can act on
them. Adding a retry queue for one congress mail would be a subsystem nobody
operates.
