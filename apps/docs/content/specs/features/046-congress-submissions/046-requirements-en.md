---
title: "046 — Congress abstracts and talk submissions"
description: "Requirements for abstract and talk submissions linked 1:N to the 044 participant registration: a structured abstract and a talk application under a Zod schema, intake in the same same-origin request as the registration, a submission window in API configuration, an email listing the submissions with a signed edit link valid until the deadline, an event-bound congress-partner role, and a read-only submissions registry in apps/admin."
slug: 046-congress-submissions
status: Draft
issues: [2379, 2385]
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/issues/2379
prior_decisions:
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0014 §2 — `realizes: US-N` traceability from `046-product.md`"
  - "ADR-0002 — Zod-first REST contract in `packages/schemas`"
  - "ADR-0001 §1 (RBAC = hybrid) and §8 (IdP = Zitadel) — `congress-partner` is an incremental coarse role from the project-roles claim"
  - "ADR-0013 — the submissions registry and card are built from `@ds/design-system` primitives, tokens-only styling"
  - "ADR-0016 §1 — one person, one entity; a submission belongs to an existing person's registration"
  - "044 — the intake path (account, consent, registration, email, window, captcha, rate limit) is reused unchanged"
lang: en
---

> **EN (this)** · **RU:** [`046-requirements-ru.md`](./046-requirements-ru.md)
>
> PRD source: [`046-product.md`](./046-product.md) (US-1…US-9). This feature's screens are the submissions registry and card in `apps/admin` and the submission form and edit page on the congress site — hence `surface: user-facing`.

# 046 — Congress abstracts and talk submissions (Requirements)

## Outcomes

- A congress participant submits abstracts and talk applications together with their 044 registration, in one request from the congress site, and may submit several.
- Until the deadline the author edits submissions and adds new ones through a signed link in the email, without a password and without signing in to the platform.
- The submission deadline is an API setting the congress site reads from the platform; changing it needs no platform release and no site edit.
- The congress partner sees their congress's submissions registry with contacts, searches and filters it by speaker and by abstract, and sees and changes nothing else on the platform.

## Scope

- Two submission kinds — abstract and talk application — and their Zod schema in `packages/schemas`.
- The 044 public intake endpoint extended with an optional submissions array; submission storage linked to the `registrations` row.
- The submission window: two API configuration keys and a public submission-form endpoint (window, topic list, field limits).
- The email listing the submissions with the edit link; the edit-by-link endpoints.
- The `congress-partner` role, its authorization boundary and admin navigation; the submissions registry and submission card in `apps/admin`.
- The submission form and edit page on the congress site (`doctor-school/orthobio-site`, orthobio-site#99) — the behaviour the site must implement over this contract.

### Out of scope

- Review, selection, decision states and publishing abstracts on the congress pages.
- Author withdrawal of a submission; deletion is a manual team action on request, as in 044.
- File uploads; exporting the registry to a file.
- The screen for granting event-bound roles — #2378; the binding mechanism itself is defined by the 044 amendment (#2380), and 046 does not redefine it.
- Submissions through the signed-in doctor's platform registration path (044 EARS-16).
- The poster as a submission kind — an owner open question (`046-product.md`, «Open questions», item 2), not a requirement.

## Constraints

- The 044 intake path (`apps/api/src/congress/congress-signup.service.ts`, `congress-signup.controller.ts`) is the only door: passwordless account through the 003 engine, consent row, registration, email through `apps/api/src/mailer/notice-emails.ts`. 046 adds no second public account-creating endpoint.
- `registrations` is unique on `(user_id, event_id)` (`packages/db/src/schema/registrations.ts`); submissions reference that row, and the participant's answers stay in its `answers` column (`registrations.ts:147`).
- The API has no CORS; the congress site talks same-origin through its own nginx `/api` proxy (044 EARS-1, EARS-2).
- The 044 window is read from `CONGRESS_SIGNUP_WINDOW_OPENS_AT` / `CONGRESS_SIGNUP_WINDOW_CLOSES_AT` in `apps/api/src/congress/congress-signup.config.ts`; the submission window mirrors that shape rather than inventing its own.
- Who created or changed a record, and when, is the spec 010 mechanism (`apps/api/src/audit/README.md`).
- Binding a role to an event is the store the 044 amendment defines (#2380); the role set is `apps/api/src/authz/authz.types.ts:18-30`.

## Prior decisions

- Product-owner decisions (chat, 2026-09-25), verbatim (RU):
  - «Существует три варианта участия в Конгрессе, для каждого из них предусмотрена своя форма: Участник … Каждая другая форма подразумевает заполнение формы участника. То есть быть участником обязательно в любом случае, остальные два варианта опциональны. Подать тезисы для обсуждения на Конгрессе. Выступить с докладом на Конгрессе. Подаётся тема, название доклада, список соавторов доклада.»
  - «Тезисы вводятся текстом, тут всё чётко структурируем, так как это контент для отображения на страницах Конгресса.»
  - On the submission deadline: «Да, но тоже вынести эту дату в настройки, чтобы можно было легко менять.»
  - «Партнёр Конгресса - видит исключительно заявки на тезисы и доклады. Не видит полный список участников … Им доступна выборка по спикерам и по тезисам. Аналогично с поиском и фильтрацией.»; «Контакты он тоже видит, так как они выходят с людьми на связь по поводу докладов. Read-only.»
  - On role grants: manual through Zitadel for now; «задачу на заведение платформенного админа и его интерфейса завести всё равно надо» (#2378).
- ADR-0006 §4 — flat `EARS-N` numbering. ADR-0014 §2 — every EARS carries `realizes: US-N`.
- ADR-0002 — Zod-first contract in `packages/schemas`. ADR-0013 — screens from `@ds/design-system` primitives, the registry on the approved `AdminDataList` composition.
- ADR-0001 §1, §8 — a coarse role from the Zitadel project-roles claim. ADR-0016 §1 — a submission belongs to one existing person entity.

## Event Model

**Commands** — `SubmitCongressSignUp` (044, extended with optional submissions), `ReadSubmissionForm` (public), `ReadOwnSubmissions` / `AddSubmission` / `EditSubmission` (by link), `ListCongressSubmissions` / `ReadCongressSubmission` (congress partner, platform administrator).

**Events** — `CongressSubmissionRecorded`, `CongressSubmissionEdited`, `SubmissionsEmailDispatched` / `SubmissionsEmailFailed`.

**Read models** — the submission form (window, topics, limits); a registration's own submissions (by link); an event's submissions registry with the submitter's contacts.

**Policies** — "no submission without a participant registration"; "the public route only appends, only the link edits"; "the submission window is evaluated before any side effect"; "a mail failure never rolls back a submission"; "the partner is deny-by-default, allowed only their event's submissions registry".

## EARS requirements

The abstract and talk field sets below are a **base set, to be confirmed by the owner** (`046-product.md`, «Open questions», item 1). The requirements refer to the field and limit tables in `046-design.md`, so the owner's final set changes those tables, not the requirement numbers or wording.

### Work package «submission intake» — API

- **EARS-1** (`realizes: US-1, US-2`) — The SYSTEM SHALL distinguish exactly two submission kinds, `abstract` and `talk`, and SHALL validate every submission against a Zod schema in `packages/schemas/src/congress/` discriminated on the kind; every submission carries a client-generated identifier (UUID).
- **EARS-2** (`realizes: US-1`) — The SYSTEM SHALL accept an abstract only with every field of the base abstract set in `046-design.md` («Abstract field set») — title, a topic from the closed topic list, one or more authors, the sections «Актуальность», «Материалы и методы», «Результаты», «Выводы», and keywords — and SHALL refuse an abstract whose section or field exceeds its character limit, counted on the server after trimming surrounding whitespace; the topic is accepted only as a value of the closed list, never as free text.
- **EARS-3** (`realizes: US-2`) — The SYSTEM SHALL accept a talk application only with a topic from the same closed list, a talk title and a co-author list per `046-design.md` («Talk field set») in which at least one co-author is flagged as presenting.
- **EARS-4** (`realizes: US-1, US-2`) — The SYSTEM SHALL normalise every author's surname, first name and patronymic by the 044 EARS-33 rule and the author's email by trimming and lower-casing before storage; the author's workplace is stored as typed.
- **EARS-5** (`realizes: US-1, US-2, US-3`) — The SYSTEM SHALL accept an optional submissions array, at most 10 per request, in the body of the 044 public intake endpoint; WHEN the array is non-empty, the SYSTEM SHALL first run the whole 044 cascade unchanged — captcha, rate limit, registration window, account, consent, registration — and SHALL write each submission as a row linked to that participant's `registrations` row for that event, in the same transaction as the registration; a submission is never written without a registration row.
- **EARS-6** (`realizes: US-3`) — WHEN a public request carries a submission whose client identifier is already recorded for the same registration, the SYSTEM SHALL create no second row and SHALL NOT change that submission's stored content; the public route only appends, and editing an existing submission is possible only through the link (EARS-13, EARS-14). A registration holds at most 10 submissions; a request exceeding that bound is refused whole before any side effect.
- **EARS-7** (`realizes: US-1, US-2, US-3`) — The SYSTEM SHALL answer a request carrying submissions with exactly the same `{ "status": "accepted" }` response, status code and timing class as 044 EARS-7, regardless of whether the account existed, whether the registration existed, and whether any of the submissions were already recorded.
- **EARS-8** (`realizes: US-8`) — The SYSTEM SHALL read the submission window from two required API configuration keys, `CONGRESS_SUBMISSION_WINDOW_OPENS_AT` and `CONGRESS_SUBMISSION_WINDOW_CLOSES_AT` — ISO-8601 date-times with an explicit offset, the close strictly after the open — validated next to the 044 keys in the congress module configuration; an offset-less, unparseable or inverted window SHALL close submissions (fail closed). The production values are 2026-10-01T00:00+03:00 and 2026-12-01T00:00+03:00 per the owner's current decision; no database row and no admin screen is added for the window.
- **EARS-9** (`realizes: US-9`) — WHEN a request with a non-empty submissions array arrives before the submission window opens, the SYSTEM SHALL refuse it whole with the machine-readable state `submissions-not-yet-open`, carrying the opening instant; WHEN after it closes, with the state `submissions-closed`; the submission window SHALL be evaluated right after the 044 registration window and before any side effect, and the refusal SHALL be identical for every submitter. A request without submissions is not bound by the submission window and follows only the 044 window.
- **EARS-10** (`realizes: US-8, US-9`) — The SYSTEM SHALL expose a public, read-only, cacheable submission-form endpoint through the same same-origin proxy, returning the submission-window state (`not-yet-open` / `open` / `closed`) with both instants, the closed topic list and every field's character limit from the same schema declaration the server validates submissions with, so that the site never holds its own copy of the dates, topics or limits.
- **EARS-11** (`realizes: US-5`) — The SYSTEM SHALL, after the submissions commit and off the response path, send the author an email rendered through `apps/api/src/mailer/email-layout.ts` in the shape of `notice-emails.ts`, listing every submission of the registration (kind, title, topic, authors with the presenting flag) and carrying the edit link of EARS-13; WHEN the registration was created in the same request, the SYSTEM SHALL send one email — the 044 confirmation with a submissions block — not two. The email copy is approved at Stage A.
- **EARS-12** (`realizes: US-5`) — The SYSTEM SHALL record the submissions-email outcome (sent or failed, with a timestamp) on the registration and SHALL NOT roll back, delay or fail the submission write because of a send failure; WHEN a repeated public request or a link edit finds the recorded outcome `failed`, the SYSTEM SHALL send the email again.
- **EARS-13** (`realizes: US-4`) — The SYSTEM SHALL issue the edit link as an HMAC-SHA256-signed token over the registration id, keyed by `CONGRESS_SUBMISSION_LINK_SECRET`, placed in the URL fragment of the congress-site edit page and passed to the API in the `x-congress-submission-token` header; the token SHALL grant access only to that registration's submissions, SHALL NOT create a platform session or sign in to the account, and its fitness for writing SHALL expire with the submission window evaluated at the time of use. An invalid, forged or foreign token SHALL receive one and the same generic refusal.
- **EARS-14** (`realizes: US-4, US-9`) — The SYSTEM SHALL expose, under the EARS-13 token, reading the registration's own submissions, adding a new submission, and replacing an existing submission's content by its client identifier, validated by EARS-1…EARS-4 and bounded by EARS-6; a write SHALL be refused with the EARS-9 states before any side effect when the submission window is not open, while reading SHALL stay available for as long as the registration exists, so that after the deadline the author sees their submissions read-only. Every successful write triggers the EARS-11 email.
- **EARS-15** (`realizes: US-4, US-6`) — The SYSTEM SHALL keep the creation and last-change instants on every submission row and SHALL record every submission creation and edit through the spec 010 who/when mechanism, with the registration's account as the actor and the channel (`public-intake` or `edit-link`).

### Work package «partner role and submissions registry» — API and `apps/admin`

- **EARS-16** (`realizes: US-6, US-7`) — The SYSTEM SHALL add `congress-partner` to the API role set as a coarse role from the Zitadel project-roles claim and SHALL restrict it to one event through the event-role binding store defined by the 044 amendment (#2380); an event's partner sees only that event's submissions.
- **EARS-17** (`realizes: US-7`) — The SYSTEM SHALL refuse a principal holding only `congress-partner` on every API endpoint except the submissions list and submission card of their own event and the session endpoints — including the 044 participant roster, its printable sheet, other events' submissions and every mutation. The list and card are also allowed to the platform administrator for any event.
- **EARS-18** (`realizes: US-7`) — The SYSTEM SHALL show a principal holding only `congress-partner` a single admin navigation item — the submissions registry; the client-side gate is a projection of the EARS-17 server refusal, never its replacement.
- **EARS-19** (`realizes: US-6`) — The SYSTEM SHALL render the submissions registry in `apps/admin` on the `AdminDataList` composition with the columns №, kind, title, topic, speakers, authors, submitter (full name), email, phone, submitted, changed, and SHALL sort it on the server by any column except № in both directions, with the sort state carried in the list query together with search, filters and page.
- **EARS-20** (`realizes: US-6`) — The SYSTEM SHALL offer server-side registry filters — a select on kind and on topic; a «speaker» contains-search over the full name and workplace of co-authors flagged as presenting; an «abstract» contains-search over the abstract title, topic and keywords; a contains-search over any author's full name and over the submitter's full name, email and phone; a range on the submission date — each composable with the others, with sort and with page.
- **EARS-21** (`realizes: US-6`) — The SYSTEM SHALL open from a registry row a submission card with the full content — every abstract or talk field, the authors with workplace, email and the presenting flag — and the submitter's contacts: full name, email and contact phone from the 044 registration answers.
- **EARS-22** (`realizes: US-7`) — The SYSTEM SHALL render the registry and the card read-only: no create, edit or delete affordance appears for any role, and the API exposes no admin mutation of a submission.

### Work package «congress-site forms» — orthobio-site#99

The UX shape below is a proposal awaiting the owner's confirmation (`046-product.md`, «Open questions», item 3); the requirements fix the behaviour the API contract depends on, and Stage A sets the visual shape.

- **EARS-23** (`realizes: US-1, US-2, US-3`) — The SYSTEM SHALL render one form on the congress site: the mandatory 044 participant block, then «Подать тезисы» and «Подать заявку на доклад» sections, each addable several times and removable before submitting, with an author repeater and a character counter under every limited field per the EARS-10 limits, and SHALL send the participant and all submissions in one EARS-5 request, generating each submission's client identifier once when it is added to the form.
- **EARS-24** (`realizes: US-9`) — The SYSTEM SHALL, on the congress site, read the submission-window state from EARS-10 and, WHEN it is not `open`, SHALL NOT show the submission sections, showing instead a message that intake is not yet open (with the opening date) or closed, while the participant block stays available under the 044 window rules.
- **EARS-25** (`realizes: US-4`) — The SYSTEM SHALL render on the congress site an edit page that reads the token from the URL fragment, passes it in the EARS-13 header, shows the registration's submissions in the same form sections, lets the author correct them and add new ones while the submission window is open, and shows them read-only when it is closed.

## Invariants

- No submission exists without a participant registration row for the same event; deleting the registration deletes its submissions (EARS-5).
- The public route never changes or deletes a recorded submission; only the link holder edits (EARS-6, EARS-14).
- The intake response carries no enumeration signal: the same `accepted` on every path, with or without submissions (EARS-7).
- The submission window is evaluated before any side effect; a request with submissions outside the window leaves no account, registration, submission or email behind (EARS-9).
- Window dates, topics and field limits live in one place — the API configuration and schema; the site only reads them (EARS-10).
- The edit link is not a sign-in: it never creates a platform session and grants nothing beyond its own registration's submissions (EARS-13).
- `congress-partner` is deny-by-default: only their event's submissions list and card and the session endpoints are allowed (EARS-17).
- A mail failure never looks like a lost submission (EARS-12).

## Verification

| #    | Type                                                | What it proves                                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Vitest unit — `packages/schemas`                    | The schema accepts a base-set abstract and talk; refuses each section over its limit, an off-list topic, a talk without a presenter; normalises author names and emails idempotently (EARS-1…EARS-4).                                                           |
| V-2  | Vitest e2e — `apps/api`                             | New email + one abstract → account, registration, consent per 044 and one submission row on that registration; response `{ "status": "accepted" }` (EARS-5, EARS-7).                                                                                            |
| V-3  | Vitest e2e — `apps/api`                             | Existing registration + two new talks → two rows on the same registration, no second registration; response identical to V-2 (EARS-5, EARS-7).                                                                                                                  |
| V-4  | Vitest e2e — `apps/api`                             | The same body repeated with changed abstract text → no new row, stored text unchanged; an 11th submission on a registration → refusal with no side effect (EARS-6).                                                                                             |
| V-5  | Vitest e2e — `apps/api`                             | Before the submission window opens and after it closes → `submissions-not-yet-open` / `submissions-closed` with no account, registration, submission or email; a request without submissions after the deadline → accepted per 044 (EARS-9).                    |
| V-6  | Vitest unit — `apps/api`                            | Window keys: offset-less, unparseable, inverted → submissions closed (EARS-8).                                                                                                                                                                                  |
| V-7  | Vitest e2e — `apps/api`                             | The submission-form endpoint returns the window state, instants, topics and limits equal to the schema declaration, unauthenticated and cacheable (EARS-10).                                                                                                    |
| V-8  | Vitest e2e — `apps/api`                             | A new registration with submissions → one email with the submissions block and link; adding by link → an email with the updated list; mail failure → submission kept, outcome `failed`, a retry resends (EARS-11, EARS-12).                                     |
| V-9  | Vitest e2e — `apps/api`                             | The emailed token reads, adds and edits only its own registration's submissions; a forged and a foreign token → one generic refusal; after the deadline reading works and writing → `submissions-closed`; no session is created (EARS-13, EARS-14).             |
| V-10 | Vitest e2e — `apps/api`                             | Creation and edit leave the instants on the row and a who/when record with the account and channel (EARS-15).                                                                                                                                                   |
| V-11 | Vitest e2e — `apps/api`                             | A principal holding only `congress-partner` bound to event A: A's list and card allowed; event B, the 044 roster, the printable sheet and every mutation refused. The `endpoint-authz` matrix rows are the role package's delivery (EARS-16, EARS-17, EARS-22). |
| V-12 | Vitest e2e — `apps/api`                             | The submissions list sorts by every column and filters by kind, topic, speaker, abstract, author, submitter and submission date, every filter composing with the others (EARS-19, EARS-20).                                                                     |
| V-13 | Playwright / E2E — admin                            | The partner signs in, sees the single «Заявки» item, filters by kind, searches by speaker and by abstract, sorts, opens a card with the text and contacts, and finds no edit control (EARS-18…EARS-22).                                                         |
| V-14 | axe                                                 | A clean `playwright-axe` run on the submissions registry and card (ADR-0013, EARS-19, EARS-21).                                                                                                                                                                 |
| V-15 | Playwright / E2E — congress site (orthobio-site#99) | Participant + abstract + talk in one submission; character counters per the API limits; no submission sections outside the window; the edit page from the link edits and adds a submission (EARS-23…EARS-25).                                                   |

## Work-package map

The package Issues are opened by `open-ears-issues` once the owner confirms the field set; until then the packages are named by content.

| EARS            | Work package                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-1…EARS-15  | **Submission intake** — schema, the 044 intake extension, submission storage, the submission window and form endpoint, email, edit link and its endpoints |
| EARS-16…EARS-22 | **Partner role and submissions registry** — the `congress-partner` role, authorization boundary, admin navigation, registry and card                      |
| EARS-23…EARS-25 | **Congress-site forms** — orthobio-site#99: submission form, window state, edit page                                                                      |
