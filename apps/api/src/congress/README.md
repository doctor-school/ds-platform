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
| `congress-signup.service`    | The order of the checks and the one transaction the accepted path writes in — for both doors (`site`, and the registrar's `desk`, EARS-35).      |
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

All seven keys are validated at request time and a missing or malformed value
refuses the intake generically — the endpoint never runs with a half-configured meaning.

| Env key                            | Meaning                                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONGRESS_SIGNUP_EVENT_ID`         | The uuid of the congress event every submission is registered for.                                                                                                                                                                                                     |
| `CONGRESS_SIGNUP_CONSENT_VERSION`  | `YYYY-MM-DD.sha256-<64 hex>` — publication date + digest of the published personal-data text (ADR-0009 §2.1). Stamped by the server; never taken from the caller.                                                                                                      |
| `CONGRESS_SIGNUP_EVENT_VENUE`      | The venue the confirmation email names («{место}», EARS-13). REQUIRED: a missing or blank value refuses every submission. There is no venue column on `events` — the venue is a constant of THIS congress.                                                             |
| `CONGRESS_SIGNUP_WINDOW_OPENS_AT`  | REQUIRED (EARS-28). The instant the intake starts accepting submissions, ISO-8601 with an explicit offset (`2026-10-01T00:00:00.000+03:00` or `…Z`). An offset-less value is refused, never guessed. Echoed verbatim in the `not-yet-open` refusal.                    |
| `CONGRESS_SIGNUP_WINDOW_CLOSES_AT` | REQUIRED (EARS-28). The instant it stops, same format, strictly after the open. The closing instant is OUTSIDE the window (half-open interval).                                                                                                                        |
| `CONGRESS_SIGNUP_EVENT_DAYS`       | REQUIRED (EARS-34). The congress days, comma-separated ascending ISO dates without repeats (`2027-04-23,2027-04-24`). The registrar's desk marks attendance on these days only (`registration/README.md`); unset or malformed also refuses the intake, like the venue. |
| `CONGRESS_SIGNUP_TIMING_FLOOR_MS`  | Optional. Whole milliseconds the intake response is padded to, so the new-account and existing-account branches take the same time on the wire (EARS-7). Unset ⇒ the conservative default `1000`.                                                                      |

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

## Two doors, one intake (044 EARS-35)

`CongressSignUpService.signUp(request, intake)` takes the door as a parameter:
`{ origin: "site" }` from this module's public route, and
`{ origin: "desk", eventKey, consentOrigin: "paper" }` from the registrar's
`POST /v1/admin/events/:idOrSlug/registrations` in `registration/` (its
README has the route). The desk skips only the registration window and takes
the event from the admin route instead of `CONGRESS_SIGNUP_EVENT_ID`; the
account, registration, consent and confirmation-email steps are the same code.
The door is stamped on `registrations.intake_origin` (`site` | `desk`; the
signed-in platform path takes the default `platform`) and a new desk consent
row on `consent_records.origin = 'paper'`. The use-case returns the
registration id and whether this call created it; the public route still
answers the one `accepted` state (EARS-7), the desk names the registration.

## Slice state

Both intake paths are live: a NEW email gets an account created for it, and an
email the platform already knows has the registration attached to the account it
already has, with no profile field rewritten and the same `accepted` response.
Repeat submissions write no second registration and no second consent row at the
same published version.

The confirmation email is live too. It is dispatched AFTER the transaction has
committed and is never awaited by the response: a slow or unreachable relay can
neither delay an accepted submission nor turn it into a refusal. Its one action
is «Подать материалы в кабинете», the absolute cabinet link on
`MAILER_DOCTOR_BASE_URL` (046 EARS-15; see «Letter link origin» below).

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

## Congress intake settings (feature 046, EARS-1…EARS-3)

Spec: `apps/docs/content/specs/features/046-congress-submissions/`.

| File                                        | Role                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `congress-intake-settings.admin.controller` | `GET` / `PUT /v1/admin/events/:id/congress-intake-settings` — `platform_admin` only, the `PUT` revalidates live.   |
| `congress-intake-settings.service`          | Reads the settings (or the product defaults), stores Moscow days as instants, writes in the request audit context. |

The settings are platform data, not environment (046-design «Settings in platform
data»): `congress_submission_settings` per event (registration address,
first-author rule) and
`congress_submission_kind_settings` per event and kind (`oral`, `poster`,
`abstract`: opening, closing, submit limit, age limit). An event without a
settings row has no congress section; the read then answers
`configured: false` with the defaults (abstracts 3, poster age 40). A save is
read on the next request, and both tables carry the 010 `audit_row_change()`
trigger — the ledger answers «who moved the deadline». An unchanged row is not
rewritten, so the ledger records changes, not saves.

Dates cross the wire as Moscow calendar days and are stored as instants through
the one conversion in `@ds/schemas` (`congress-intake-settings.schema.ts`): the
opening day at 00:00 Moscow, each last day at 00:00 Moscow of the day after.
The same file holds `isCongressKindIntakeOpen`, the intake rule every later
surface of 046 uses.

## Congress submissions — the author's cabinet (feature 046, EARS-5…EARS-17)

| File                                 | Role                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `congress-submissions.me.controller` | `/v1/me/congress-submissions*` — `authenticated` / `doctor_guest` / `fast-path`, every row self-scoped. |
| `congress-submissions.service`       | The section read, draft create/autosave/delete, the send cascade and the withdraw.                      |

Endpoints: `GET [?event=]` (the section: the event's slug, title and dates,
registration presence, per-kind intake state and limit usage, the next send's
consent requirement, the account's submissions; without `event` — the event
with intake settings that starts latest, which `/account/congress` shows),
`POST` (create a draft), `PATCH /:id` (autosave), `POST /:id/send`,
`POST /:id/withdraw {expectedStatus}`, `DELETE /:id` (drafts only). A row of
another account, or one whose registration is no longer active, is 404.
Refusals carry `{problems: [{code, field?, params?}]}` — 422 for an unmet send
condition, 409 for a status the action does not apply to; the codes live in
`@ds/schemas` (`congress-submission.schema.ts`) with the field limits, the
length rule and the per-kind forms. A kind is offered once its form is
registered there (oral now; posters and abstracts with their slices); creating
a draft of a kind not offered yet is 422 `kind-not-available`.

- **Send cascade (EARS-9).** One transaction: the row locked, an advisory lock on
  (account, event, kind), then registration, the kind window, the complete field
  set, the limit and the consent are all checked and every failure named; a
  refusal throws inside the transaction, so nothing is written. Author names
  are normalised by the 044 EARS-33 rule on send.
- **Resend after revision (EARS-9, EARS-30).** A `needs_revision` submission is
  sent again through the same cascade, which checks its own `revision_due_at`
  instead of the kind window (`revision-closed` from that instant) and writes
  `submitted` conditional on the status seen; it gets a new receipt letter, the
  limit never counts it a second time (the row being sent is excluded), and the
  consent is asked again only for a new version. Any other non-draft status is
  `status-conflict`.
- **Limit (EARS-17).** Counts the account's submissions of the event and kind in
  any status except `draft` — `rejected` and `withdrawn` included — the one being
  sent excluded, under the advisory lock, so two tabs cannot both take the last
  slot.
- **Submission consent (EARS-16).** Purpose `congress-submission-personal-data`,
  version = the congress site policy stamp `CONGRESS_SIGNUP_CONSENT_VERSION`
  (read through `resolveCongressConsentVersion`, the same reader 044 uses). The
  send asks for it while the account has no row of that purpose at the current
  version — one row per account and version, whatever the event.
- **Withdraw (EARS-12).** `submitted` while the kind is open → `draft`;
  `in_review`, `needs_revision`, or `submitted` after closing → `withdrawn`. The
  update matches only a row still in `expectedStatus`, so a concurrent committee
  change wins and the withdraw is refused with the current status.
- **Delete (EARS-13).** Retires the draft (`record_status = 'retired'`,
  `deleted_at` set — the ADR-0003 §3.6 retained-row rule; no physical delete);
  a retired draft is excluded from every list, count and the kind's limit. Any
  other status is 409.
- **Author 1 (EARS-6).** Prefilled from the 044 registration answers; without
  answers its name fields stay empty for the author to fill — the display name
  is never split into a first name and a surname.
- **Receipt letter (EARS-14).** After the send transaction commits, the receipt
  («Doctor.School — заявка получена») is dispatched off the response path to
  the account email, the letter built from the committed row (kind label from
  `CONGRESS_SUBMISSION_KIND_LABELS`, the title, `events.title`). The outcome is
  recorded on the submission — `last_letter_kind = 'receipt'`,
  `last_letter_status` `sent` | `failed`, `last_letter_at` — and a relay
  failure never rolls back or delays the `submitted`. No retry queue: the
  section always shows the status.

**Letter link origin (046 «Letters»).** Every congress letter — the 046 letters
and the 044 confirmation's single action «Подать материалы в кабинете»
(EARS-15, the site form and the desk alike) — links to
`{MAILER_DOCTOR_BASE_URL}/account/congress`, resolved once at boot into the
`CONGRESS_CABINET_URL` provider. `MAILER_DOCTOR_BASE_URL` is a REQUIRED api
key (`z.url()`, no default, like `DATABASE_URL`): an api without it refuses to
boot rather than mail a link to the wrong site. Values per environment:
046-design «Letters».

`congress_submissions` (migration 0043) carries the 010 `audit_row_change()`
trigger — the ledger is the status history — and `authors` is a PD-masked
column. `revision_due_at` is read by the section and the autosave rule; the
committee's status route writes it.
