---
title: "046 — Congress submissions: oral talks, posters and abstracts"
description: "Requirements for congress submissions in a «Мои заявки на Конгресс» section of the doctor storefront account: three kinds (oral talk, poster, abstracts) as properties of the submission, many per account, autosaved drafts checked at submit, per-event and per-kind intake settings edited in apps/admin, a poster age rule from the birth date, abstract attestations and a publication consent, statuses with letters, an event-bound program committee reviewing in the admin registry and card, a read-only congress-partner view, a deadline reminder, and a cabinet link in the 044 confirmation letter."
slug: 046-congress-submissions
status: Draft
issues: [2379, 2385]
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/issues/2379
prior_decisions:
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0014 §2 — `realizes: US-N` traceability from `046-product.md`"
  - "ADR-0002 — Zod-first REST contract in `packages/schemas`"
  - "ADR-0001 §1 (RBAC = hybrid), §8 (IdP = Zitadel), §10 + A1 (live revalidation of the grant the caller acts under)"
  - "ADR-0009 §2.1 — consent versioning; §2.6 — `users` retention covers the added birth date"
  - "ADR-0013 A1 — one canonical core per capability, thin host projection; admin screens from `@ds/design-system`"
  - "ADR-0015 §2, §4 — the doctor storefront is the doctor-facing host; the API authorizes regardless of host"
  - "ADR-0016 §1, §7, §8 — one person one account; per-purpose versioned consents; storefront ownership per entity"
  - "044 — the participant registration (orthobio.ru form, desk, platform path) is the precondition and is not changed, except the cabinet link in its confirmation letter (EARS-15)"
lang: en
---

> **EN (this)** · **RU:** [`046-requirements-ru.md`](./046-requirements-ru.md)
>
> PRD source: [`046-product.md`](./046-product.md) (US-1…US-14). This feature's screens are the «Мои заявки на Конгресс» section on the doctor storefront and the submissions registry, card and intake settings in `apps/admin` — hence `surface: user-facing`.

# 046 — Congress submissions: oral talks, posters and abstracts (Requirements)

## Outcomes

- A registered congress participant signs in to the doctor storefront with the emailed code and, in «Мои заявки на Конгресс», prepares and sends any number of submissions of three kinds — oral talk, poster, abstracts — at different times, while each kind's intake is open.
- Drafts are saved automatically; completeness, the deadline, the limit and eligibility are checked only when the author sends.
- The author sees each submission's status and the committee's comment in the section and receives a letter on every status that matters.
- The program committee of the event reviews every sent submission in `apps/admin` and decides with a comment; the congress partner reads the same registry without acting.
- Opening dates, deadlines, limits and the counting rule are settings a platform administrator changes in the admin, without a release.

## Scope

- Submission storage, its Zod contract in `packages/schemas/src/congress/`, the status machine and the author and committee endpoints in `apps/api`.
- Intake settings per event and per kind in platform data and their admin screen.
- The «Мои заявки на Конгресс» section on the doctor storefront — core in the feature package `packages/congress-submissions` (`@ds/congress-submissions`), mounted by the route file `apps/doctor/app/(storefront)/account/congress/page.tsx` with a host-config object.
- The account birth date (`users.birth_date`) and the poster age rule.
- Two new consent purposes and their published documents in `packages/legal-content`.
- Author letters (receipt, accepted, rejected, needs revision, deadline reminder) and the cabinet link in the 044 confirmation letter.
- Two event-bound roles — `congress-program-committee` and `congress-partner` — over `event_role_grants`; the submissions registry, the card in the side panel and the status change in `apps/admin`.

### Out of scope

- Poster files and their layout rules — announced later by the organisers.
- Publishing abstracts on the congress pages, scoring, reviewer assignment or distribution.
- The «Подать материалы» section on orthobio.ru and the button on its «Заявка принята» card — `doctor-school/orthobio-site#99` in that repository (WBS dependency in `046-design.md`); this spec owns only the addresses the site links to.
- A congress questionnaire on the platform and any change to the login or registration mechanics of `@ds/auth-flow`.
- The screen for granting event-bound roles — #2378; until it ships the tech lead inserts `event_role_grants` rows on the product owner's request, as for the 044 registrar.
- Co-author accounts, invitations or co-author confirmation; a per-organisation limit (the organisers set none).
- A retry queue for letters; exporting the registry to a file; submission statistics (the organisers have no past-year data yet).

## Constraints

- A submission needs an active `registrations` row for (account, event) — the 044 site form, the 044 desk or the 044 EARS-16 platform path (`packages/db/src/schema/registrations.ts`, unique `(user_id, event_id)`).
- The cabinet path `/account/congress` is inside the account family that `@ds/auth-flow` already admits as a return target (`packages/auth-flow/src/return-target.ts`, `parseAccountReturnTarget`, #1987); no new return shape and no login change is needed.
- Event-scoped roles are bound in `event_role_grants` (`packages/db/src/schema/event-role-grants.ts`, `EVENT_SCOPED_ROLES` plus its CHECK); the coarse role stays in the Zitadel project-roles claim (`apps/api/src/authz/authz.types.ts`).
- Admin mutations declare `revalidate: "live"` (ADR-0001 §10); A1 names which grant is revalidated and knows only `event-registrar` besides `platform_admin` and `pd_officer`.
- Letters are sent after commit, off the response path, with the outcome recorded — the 044 EARS-11/EARS-12 pattern over `apps/api/src/mailer/email-layout.ts` and `notice-emails.ts`.
- Periodic work runs on `@nestjs/schedule` (`apps/api/src/auth/reconcile.scheduler.ts`, `apps/api/src/taxonomy/media/media-cleanup.service.ts`).
- Who changed what and when is the spec 010 change audit (`apps/api/src/audit/README.md`), reached through `withRequestAuditContext`.
- Consent documents are Markdown files in `packages/legal-content/documents/` published at `/documents/<slug>` (feature 028).

## Prior decisions

- Product-owner decisions (chat, 2026-09-29), binding for this spec:
  - The submissions live in a cabinet on the platform (variant Б), not on orthobio.ru and not behind an emailed magic link.
  - Registration stays the orthobio.ru form of 044; there is no congress questionnaire on the platform and no change to the login and registration mechanics; entry is the existing login by emailed code.
  - An account without a 044 registration sees one line «Сначала зарегистрируйтесь участником Конгресса» with a link to `https://orthobio.ru/registration`.
  - The 044 confirmation letter gets a link «Подать материалы в кабинете» — a reversal of the 2026-09-24 «no Войти» decision (#2369) for this link only.
  - Three kinds; the kind belongs to the submission; many submissions per account, any mix, any time while the kind is open; abstracts are not a talk application; «Подать тезисы по этой работе» on a talk or poster.
  - Poster age by birth date, blocked at 40 or older on the event start date; birth date asked once and reused.
  - Program committee: an event-bound role; everyone with it sees all submissions of the event; no assignment.
  - Opening date «по готовности»; deadlines — oral until 15 January 2027, poster and abstracts until 29 January 2027.
- Organisers' technical assignment for the 2027 congress (TZ, 2026-09): one account, many submissions; limits configurable in the admin, abstracts up to 3 per submitting author checked at submit; statuses черновик / отправлено / на рассмотрении / принято / отклонено / на доработке shown in the cabinet and sent by email; the field sets per kind; abstracts up to 5000 characters in the structure «Актуальность — Цель — Материалы и методы — Результаты и обсуждение — Выводы», no tables, formulas, figures, photos or trade names, with consent to publication in РИНЦ and a statement of no incorrect borrowings.
- ADR-0006 §4 — flat `EARS-N`. ADR-0014 §2 — every EARS carries `realizes: US-N`. ADR-0002 — Zod-first contract.
- ADR-0001 §1, §8 — coarse roles from the IdP claim; the resource binding lives in platform data. ADR-0001 §10 and A1 — live revalidation of the grant the caller acts under; this feature extends A1 to the committee role (EARS-28).
- ADR-0009 §2.1 — a consent is a versioned record per purpose. ADR-0016 §7 — per-purpose consents in `consent_records`; §8 — the submission is a `doctor`-owned entity, the settings are `admin-only`.
- ADR-0013 A1 — the cabinet core lives in one feature package; the host adds a route file and a host-config object. ADR-0015 §2 — congress participants are doctors, so the doctor storefront is the host.

## Event Model

**Commands** — `ReadMySubmissions`, `CreateSubmissionDraft`, `AutosaveSubmission`, `DeleteDraft`, `SetBirthDate`, `SendSubmission`, `WithdrawSubmission` (author); `ChangeSubmissionStatus` (program committee, platform administrator); `ListEventSubmissions`, `OpenSubmissionCard` (committee, partner, platform administrator); `UpdateIntakeSettings` (platform administrator).

**Events** — `SubmissionDraftCreated`, `SubmissionSent`, `SubmissionWithdrawn`, `SubmissionStatusChanged`, `SubmissionLetterSent` / `SubmissionLetterFailed`, `DeadlineReminderSent`, `IntakeSettingsChanged`.

**Read models** — the author's section (registration presence, per-kind intake state, limit usage, own submissions); the event's submissions registry; the submission card; the intake settings.

**Policies** — «no submission without a registration»; «validation, deadline, limit and eligibility are checked at send, never at autosave»; «drafts are private to their author»; «a letter failure never rolls back a status»; «committee and partner are deny-by-default outside their bound event».

## EARS requirements

Field lengths are defaults recorded in `046-design.md` («Field set and limits»); a changed limit changes that table, not the requirement numbers.

### Work package «intake settings» — API and `apps/admin`

- **EARS-1** (`realizes: US-11`) — THE SYSTEM SHALL hold congress intake settings in platform data: per event, the external registration address, the first-author counting rule (off by default) and the revision closing instant «Доработки принимаются до» (empty until set); per event and per kind (`oral`, `poster`, `abstract`), the opening instant (empty while not announced), the closing instant, the submit limit (empty = unlimited) and the age limit in whole years (empty = none). A kind's intake SHALL be open exactly when its opening instant is set, the current time is at or after it and before the closing instant; a submission's revision window SHALL end at the event's revision closing instant, independent of its kind's closing instant, or — while that setting is empty — at its kind's closing instant; an event without a settings row has no congress section and accepts no submission.
- **EARS-2** (`realizes: US-11`) — THE SYSTEM SHALL offer a platform administrator an intake-settings screen per event in `apps/admin`, prefilled for an event with no settings with the product defaults — abstracts limited to 3, oral and poster unlimited, poster age limit 40, first-author rule off, no dates — and SHALL refuse on the server a closing instant not after the opening instant, a limit that is not a positive integer and an age limit outside 18…99; a saved change SHALL take effect on the next request without a release and SHALL be recorded by the spec 010 change audit. Only the platform administrator reaches this screen and its endpoints.
- **EARS-3** (`realizes: US-11`) — THE SYSTEM SHALL take the opening, the last day of acceptance and the last day of revisions on the settings screen as calendar dates in Europe/Moscow and SHALL store the opening as 00:00 of that day and each closing — the kind's and the revision one — as 00:00 of the day after the last day, so that a kind, or a revision window, is open through 23:59:59 Moscow time of its last day; every surface SHALL show the last day as «до {дата} включительно».

### Work package «cabinet and oral talks» — API, `packages/congress-submissions`, `apps/doctor`

- **EARS-4** (`realizes: US-1`) — THE SYSTEM SHALL render the section «Мои заявки на Конгресс» on the doctor storefront at `/account/congress`, linked from the account page, as the route-file mount of `@ds/congress-submissions`; WHEN a guest opens it, THE SYSTEM SHALL send them to the existing login with `/account/congress` as the return target and land them back on the section after the emailed-code sign-in, through the account-family return shape `@ds/auth-flow` already admits, with no change to the login or registration mechanics.
- **EARS-5** (`realizes: US-2`) — WHEN the signed-in account has no active registration for the event, THE SYSTEM SHALL show in the section only the line «Сначала зарегистрируйтесь участником Конгресса» with a link to the event's registration address (EARS-1), and SHALL refuse on the server creating any submission for an (account, event) pair without an active `registrations` row.
- **EARS-6** (`realizes: US-6, US-7`) — WHEN a registered participant chooses a kind, THE SYSTEM SHALL create a draft of that kind owned by the account and linked to its registration, with author 1 prefilled from the registration answers (surname, first name, patronymic, workplace) or, where the registration has no answers, from the account display name; creating a draft is refused only after the kind's closing instant.
- **EARS-7** (`realizes: US-7`) — THE SYSTEM SHALL save a draft's content automatically after the author pauses typing and when a field loses focus, with no save button, showing the saved state; an autosave SHALL accept incomplete content, enforcing only field types and maximum lengths, and SHALL be refused for a submission whose status is not `draft` or `needs_revision`.
- **EARS-8** (`realizes: US-3`) — THE SYSTEM SHALL require for an oral talk the title, one to twenty ordered authors — each with surname, first name, optional patronymic and workplace, exactly one marked as presenting — the educational goal and the summary, each within its `046-design.md` limit, SHALL normalise author names by the 044 EARS-33 rule, and SHALL show the informational line «Формат участия — очный».
- **EARS-9** (`realizes: US-7`) — WHEN the author sends a submission, THE SYSTEM SHALL check, in one transaction and before any change, the complete field set of its kind, that the kind's intake is open — or, for a submission in `needs_revision`, that its revision window (EARS-1) has not ended —, the limit (EARS-17), the kind's eligibility (EARS-20) and the required consents and statements (EARS-16, EARS-23), and on success SHALL set the status `submitted` with the send instant; a refusal SHALL change nothing and SHALL name each unmet condition in plain language next to the form.
- **EARS-10** (`realizes: US-7`) — WHILE a draft's kind is not open, THE SYSTEM SHALL show on the draft why it cannot be sent — «Приём {вида} откроется {дата}», «Дату открытия приёма объявят позже» or «Приём {вида} закрыт {дата} — отправить заявку нельзя» — and SHALL offer no active send action; the draft stays readable.
- **EARS-11** (`realizes: US-6, US-8`) — THE SYSTEM SHALL list in the section every submission of the account for the event, any mix of kinds, with the kind, the title, the status label, the last change and, for `rejected` and `needs_revision`, the committee comment, and for `needs_revision` the last day of its revision window as «Исправить и отправить можно до {дата} включительно»; a submission whose status is neither `draft` nor `needs_revision` opens read-only.
- **EARS-12** (`realizes: US-9`) — WHEN the author withdraws a `submitted` submission before its kind's closing instant, THE SYSTEM SHALL return it to `draft`, after which it no longer counts toward the limit and disappears from the committee registry; a submission in any other status, or after the closing instant, SHALL NOT be withdrawn.
- **EARS-13** (`realizes: US-7`) — THE SYSTEM SHALL let the author delete a submission in status `draft`, after confirmation, and SHALL refuse deleting a submission in any other status.
- **EARS-14** (`realizes: US-8`) — THE SYSTEM SHALL, after the transaction that sets `submitted` commits and off the response path, send the author a receipt letter rendered through `email-layout.ts` naming the kind, the title and the event and linking to the section, and SHALL record on the submission the letter kind, its outcome (sent or failed) and its timestamp; a send failure SHALL NOT roll back or delay the status. The letter copy is approved at Stage A.
- **EARS-15** (`realizes: US-14`) — THE SYSTEM SHALL add to the 044 confirmation letter — the site form and the desk alike — the link «Подать материалы в кабинете» to `/account/congress` on the doctor storefront, as the only action of that letter; the 044 production amendment of 2026-09-29 records this reversal of the 2026-09-24 copy for this link only.
- **EARS-16** (`realizes: US-3, US-4, US-5`) — WHEN an account sends its first submission of an event, THE SYSTEM SHALL require acceptance of the congress submission personal-data consent — the published document `consent-congress-submission` covering the submission content, the co-authors' data the author supplies, the birth date for the poster rule, and disclosure to the event's program committee and congress partner — and SHALL record one `consent_records` row under the purpose `congress-submission-personal-data` with the server-stamped version (edition plus sha256 of the published text); WHEN the published version changes, THE SYSTEM SHALL ask again at the next send.
- **EARS-17** (`realizes: US-6`) — WHERE a kind has a submit limit, THE SYSTEM SHALL refuse a send when the account already holds that many other submissions of that event and kind — the one being sent excluded — in `submitted`, `in_review`, `accepted` or `needs_revision` — drafts and rejected submissions do not count — serialising concurrent sends of one account, event and kind, and SHALL name the limit in the refusal («Можно отправить не больше {N} …»).

### Work package «posters» — API, `packages/congress-submissions`

- **EARS-18** (`realizes: US-4`) — THE SYSTEM SHALL require for a poster the title, the authors as for an oral talk (EARS-8), the goal and the content, each within its `046-design.md` limit; no file is accepted.
- **EARS-19** (`realizes: US-4`) — WHEN the author starts a poster and the account has no birth date, THE SYSTEM SHALL ask for it before creating the draft and SHALL store it once on the account (`users.birth_date`), written only by the account holder, shown to them for correction in the poster flow, and never shown to the congress partner.
- **EARS-20** (`realizes: US-4`) — WHERE a kind has an age limit, THE SYSTEM SHALL refuse creating and sending a submission of that kind when the account holder's age in full years on the event's start date in Europe/Moscow is at or above the limit, with the plain explanation «Постерные доклады принимают от участников младше {N} лет на дату начала Конгресса ({дата})», while every other kind stays available.

### Work package «abstracts» — API, `packages/congress-submissions`

- **EARS-21** (`realizes: US-5`) — THE SYSTEM SHALL require for abstracts the title, the authors (without a presenting mark) and five plain-text sections «Актуальность», «Цель», «Материалы и методы», «Результаты и обсуждение», «Выводы», each non-empty at send, and SHALL refuse a send whose five sections together exceed 5000 characters including spaces, counted as `046-design.md` («Abstract length») defines, by the same `packages/schemas` function the form's counter uses.
- **EARS-22** (`realizes: US-5`) — THE SYSTEM SHALL show one total counter for the five abstract sections, updated as the author types and marked when above 5000, and SHALL accept only plain text — no formatting, tables, formulas, images or uploads are possible in the form or the contract.
- **EARS-23** (`realizes: US-5`) — WHEN the author sends abstracts, THE SYSTEM SHALL require the consent to publication in РИНЦ — the published document `consent-congress-abstract-publication`, recorded as one `consent_records` row per send under the purpose `congress-abstract-publication` with the server-stamped version and referenced from the submission — and two statements, «в тексте нет некорректных заимствований» and «в тексте нет торговых наименований», stored on the submission with their instant.
- **EARS-24** (`realizes: US-6`) — WHERE the event's first-author rule is on, THE SYSTEM SHALL also refuse a send when the event already holds, from any submitter, as many submissions of that kind in the counted statuses of EARS-17 whose first author has the same normalised full name as this submission's first author.
- **EARS-25** (`realizes: US-6`) — WHEN the author chooses «Подать тезисы по этой работе» on an oral talk or a poster, THE SYSTEM SHALL create an abstract draft prefilled with its title and authors and linked to that submission, subject to EARS-6; the link is shown on the abstract card in the admin.

### Work package «program committee» — API, `apps/admin`

- **EARS-26** (`realizes: US-10`) — THE SYSTEM SHALL add `congress-program-committee` to the API role set as a coarse role from the Zitadel project-roles claim, bound to one or more events by `event_role_grants` rows, and SHALL allow a principal holding only that role the submissions registry, the card and the status change of its bound events and the session endpoints, refusing server-side every other endpoint and every other event; a principal with the role and no binding is refused everywhere except the session endpoints; the platform administrator is not limited by a binding.
- **EARS-27** (`realizes: US-10, US-12`) — THE SYSTEM SHALL render the event's submissions registry in `apps/admin` on the `AdminDataList` composition with the columns №, вид, тема, подающий, статус, отправлена, изменена, SHALL never list a submission in `draft`, and SHALL offer server-side sort by every column except № and server-side filters by kind, status, send-date range and a submitter contains-search over full name and email, plus a search over the title and author names, each composable with the others and with the page.
- **EARS-28** (`realizes: US-10`) — WHEN a committee member or a platform administrator opens a registry row, THE SYSTEM SHALL show the card in the `@ds/design-system` `Sheet` side panel with the full content, the authors, the submitter's email and contact phone, the status history with who and when from the 010 audit, the linked source work (EARS-25), the last letter outcome and, for a poster, the submitter's age on the event start date instead of the birth date; the card's status control SHALL set `in_review`, `accepted`, `rejected` or `needs_revision` along the transitions of `046-design.md` («Status machine»), SHALL require a comment of 1–2000 characters for `rejected` and `needs_revision`, SHALL run through `withRequestAuditContext` and SHALL be live-revalidated against the committee grant by an ADR-0001 A1 extension delivered in this work package.
- **EARS-29** (`realizes: US-8`) — WHEN a status changes to `accepted`, `rejected` or `needs_revision`, THE SYSTEM SHALL send the author a letter after commit naming the submission and the new status and, for `rejected` and `needs_revision`, carrying the committee comment verbatim and, for `needs_revision`, the last day of its revision window (EARS-1), with the outcome recorded as in EARS-14; a change to `in_review` sends no letter. The copy is approved at Stage A.
- **EARS-30** (`realizes: US-9`) — WHILE a submission is `needs_revision` and its revision window (EARS-1) has not ended — even after its kind's closing instant, when the event's revision closing instant is later — THE SYSTEM SHALL let the author edit it (EARS-7) and send it again through EARS-9, which returns it to `submitted` with a new receipt letter; after the window ends it SHALL stay read-only with the explanation that revisions were accepted until {дата} inclusive.
- **EARS-31** (`realizes: US-10, US-12`) — THE SYSTEM SHALL render the admin navigation of a principal holding only `congress-program-committee` or only `congress-partner` as the «Заявки» entries of its bound events and nothing else, and SHALL show a platform administrator «Заявки» and «Настройки приёма» per event; the client gate is a projection of the server refusals of EARS-26 and EARS-32, never their substitute.

### Work package «congress partner» — API, `apps/admin`

- **EARS-32** (`realizes: US-12`) — THE SYSTEM SHALL add `congress-partner` as a coarse role bound to events by `event_role_grants` and SHALL allow a principal holding only that role the registry and the card of its bound events read-only — without the status control, without the committee comment and without the submitter's age — refusing server-side every mutation, every other event and every other endpoint except the session endpoints.

### Work package «deadline reminder» — API

- **EARS-33** (`realizes: US-13`) — THE SYSTEM SHALL run a scheduled sweep on `@nestjs/schedule` that, for every open kind whose closing instant falls within the next 72 hours, sends each account holding at least one draft of that kind one reminder letter listing those drafts and the last day, at most once per account, event, kind and closing instant — claimed by a conditional update so that parallel API instances never send twice — with the outcome recorded; a moved closing instant re-arms the reminder. The copy is approved at Stage A.

## Invariants

- No submission exists without an active registration of its author for the same event (EARS-5).
- A draft is visible only to its author: the registry, the card and every committee or partner read exclude `draft` (EARS-27).
- Completeness, the deadline, the limit and eligibility are decided at send, in one transaction; autosave never refuses incomplete content (EARS-7, EARS-9).
- Only the transitions of the status machine exist: the author moves `draft → submitted`, `submitted → draft` (withdraw) and `needs_revision → submitted`; the committee moves the rest (EARS-9, EARS-12, EARS-28, EARS-30).
- A rejection and a revision request always carry a comment, and the author reads the same text in the section and the letter (EARS-28, EARS-29).
- A letter failure never changes a status; the outcome is a recorded fact on the submission (EARS-14, EARS-29, EARS-33).
- Intake dates, the revision deadline, limits and the counting rule live in platform data edited by the platform administrator; no surface holds its own copy (EARS-1…EARS-3).
- The birth date is written only by its holder and reaches the admin only as the age on the event start date, and never the partner (EARS-19, EARS-28, EARS-32).
- `congress-program-committee` and `congress-partner` are deny-by-default outside their bound events (EARS-26, EARS-32).

## Verification

| #    | Type                                 | What it proves                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Vitest unit — `packages/schemas`     | Per-kind send schemas accept the complete sets and refuse each missing field, each over-limit field, zero or two presenters; the abstract length function counts spaces and line breaks and refuses 5001; the draft schema accepts incomplete content (EARS-7, EARS-8, EARS-18, EARS-21).                                         |
| V-2  | Vitest e2e — `apps/api`              | Settings: defaults for a new event; the last revision day stored as 00:00 Moscow of the next day; inverted dates, zero limit and age 17 refused; a saved change is effective on the next request and leaves a 010 audit row; a non-administrator is refused (EARS-1…EARS-3).                                                      |
| V-3  | Vitest e2e — `apps/api`              | No registration → draft creation refused; with a registration → draft with author 1 from the answers; autosave of partial content stored; autosave on `submitted` refused (EARS-5…EARS-7).                                                                                                                                        |
| V-4  | Vitest e2e — `apps/api`              | Send before opening, after closing and with an empty opening → refused with the state and no change; inside the window → `submitted`, instant stamped, receipt letter recorded; mail failure → status kept, outcome `failed` (EARS-9, EARS-14).                                                                                   |
| V-5  | Vitest e2e — `apps/api`              | First send requires the submission consent and records one row with the stamped version; a second send does not; a new published version asks again (EARS-16).                                                                                                                                                                    |
| V-6  | Vitest e2e — `apps/api`              | Abstract limit 3: the fourth send refused; a rejected one and a draft do not count; two parallel fourth sends admit none; first-author rule on → a second submitter with the same first author is refused at the limit (EARS-17, EARS-24).                                                                                        |
| V-7  | Vitest e2e — `apps/api`              | Poster: no birth date → draft refused until set; born 1987-04-23 → refused for the 2027-04-23 congress, born 1987-04-24 → allowed; oral and abstracts stay available (EARS-19, EARS-20).                                                                                                                                          |
| V-8  | Vitest e2e — `apps/api`              | Abstract send without the РИНЦ consent or a statement refused; with them → consent row per send referenced from the submission, statements stored with the instant; «Подать тезисы по этой работе» creates a linked abstract draft (EARS-23, EARS-25).                                                                            |
| V-9  | Vitest e2e — `apps/api`              | Withdraw `submitted` before closing → `draft`, no longer counted; withdraw `in_review` or after closing refused; delete draft allowed, delete `submitted` refused (EARS-12, EARS-13).                                                                                                                                             |
| V-10 | Vitest e2e — `apps/api`              | Committee bound to event A: A's registry and card allowed, event B, the 044 roster and every other endpoint refused; no binding → refused; drafts never listed; partner cannot change status and receives no comment and no age (EARS-26, EARS-27, EARS-32). The `endpoint-authz` rows are the work package's delivery.           |
| V-11 | Vitest e2e — `apps/api`              | Status change: `rejected` and `needs_revision` without a comment refused; allowed transitions pass, others refused; letters for accepted, rejected, needs revision with the comment and the last revision day, none for in review; a withdrawn committee grant → `403` from live revalidation (EARS-28, EARS-29).                 |
| V-12 | Vitest e2e — `apps/api`              | Revision deadline 2027-03-01 → a `needs_revision` talk is edited and resent on 2027-02-20, after the oral closing, → `submitted` with a receipt, the resend not counted against the limit; from 2027-03-02T00:00+03:00 autosave and send refused; with the setting empty → the kind's closing instant applies (EARS-17, EARS-30). |
| V-13 | Vitest e2e — `apps/api`              | Reminder sweep: a draft 72 hours before closing → one letter; a second run and a parallel run → none; a moved closing instant → one new letter; a kind with no drafts → none (EARS-33).                                                                                                                                           |
| V-14 | Vitest e2e — `apps/api`              | The 044 confirmation letter from the site form and from the desk carries «Подать материалы в кабинете» to `/account/congress` and no other action (EARS-15).                                                                                                                                                                      |
| V-15 | Playwright / E2E — doctor storefront | Guest opens `/account/congress`, signs in by emailed code, lands on the section; without a registration sees the one line and the link; with one creates an oral draft, reloads and finds the text autosaved, sends, sees «Отправлена», withdraws; a closed kind shows the reason and no send (EARS-4…EARS-13).                   |
| V-16 | Playwright / E2E — doctor storefront | Poster with birth-date entry and the age refusal; abstracts with the live total counter over 5000, the consent and statements; «Подать тезисы по этой работе» from a talk card (EARS-18…EARS-25).                                                                                                                                 |
| V-17 | Playwright / E2E — admin             | Platform administrator edits intake settings; committee member sees only «Заявки», filters by kind and status, opens the card in the side panel, sets `needs_revision` with a comment, and the author's section shows the comment; partner sees the card with no control (EARS-2, EARS-27, EARS-28, EARS-31, EARS-32).            |
| V-18 | axe                                  | Clean `playwright-axe` runs on the section, the three forms, the registry, the card and the settings screen (ADR-0013).                                                                                                                                                                                                           |

## Work-package map

The package Issues are opened by `open-ears-issues` once the product owner has read this spec; until then the packages are named by content. Slices and Stage-A gates: `046-design.md` («Delivery slices»).

| EARS            | Work package                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| EARS-1…EARS-3   | **Intake settings** — settings storage, admin settings screen                                                         |
| EARS-4…EARS-17  | **Cabinet and oral talks** — storage, status basics, the section, oral form, send, withdraw, receipt, 044 link, limit |
| EARS-18…EARS-20 | **Posters** — poster form, birth date, age rule                                                                       |
| EARS-21…EARS-25 | **Abstracts** — sections and counter, publication consent and statements, first-author rule, abstract from a work     |
| EARS-26…EARS-31 | **Program committee** — role and binding, registry, card, status change, status letters, revision loop, admin nav     |
| EARS-32         | **Congress partner** — read-only projection of the registry and card                                                  |
| EARS-33         | **Deadline reminder** — scheduled reminder letter                                                                     |
