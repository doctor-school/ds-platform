---
"@ds/schemas": minor
"@ds/db": minor
---

#2296 — the 044 congress sign-up intake contract and the registration answers
column.

New `packages/schemas/src/congress/`: `CongressSignUpRequestSchema` (EARS-3) —
surname, first name, contact phone, email, specialty, workplace, city, region
and the personal-data consent required, patronymic optional. Specialty is a
`specialties_minzdrav` uuid and nothing else: the reserved «Другое / не
медицинский работник» option is an ordinary row of that table, so free text is
structurally unrepresentable rather than merely refused. The consent is
`z.literal(true)` — a precondition of the command, not a field that can arrive
`false` — and its version is server-stamped, so the client sends no version at
all. The captcha token rides the body optionally, mirroring
`DoctorRegisterRequestSchema` and how `BotProtectionGuard` actually reads it
(header first, body fallback, no-op while the provider is disabled).

`normaliseContactPhone` (EARS-29) applies the same rule the client-side input
mask already applies — digits only, a domestic-length leading `8` rewritten to
the `7` country code, capped at the E.164 maximum — so the server and the form
agree on what one phone number is. `CongressSignUpAnswersSchema` is the stored
shape: the same answers with the phone kept twice, as typed and normalised, and
neither the consent flag nor the captcha token. `toCongressSignUpAnswers` is its
only assembler, so no call site can hand-build the column value.

`registrations` gains a nullable `answers` jsonb column (EARS-5, migration
`0037_registration_answers`). Nullable is the decision: `null` means a
platform-origin registration — a signed-in doctor registering from the feed
submits no answers, and the roster renders that row from the account's own
profile instead.
