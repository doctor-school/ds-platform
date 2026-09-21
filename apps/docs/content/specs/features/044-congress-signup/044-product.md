---
title: "Feature 044 — Congress sign-up (PRD)"
description: "Product requirements for the congress sign-up vertical slice: the public intake form on orthobio.ru (repo doctor-school/orthobio-site), the platform API that turns a submission into a registration AND a passwordless Doctor.School account, a restricted admin roster with a printable attendance sheet, and a confirmation email. Owner-widened 2026-09-21 from a bare backend intake write to this full slice; supersedes the functional-map's backend-only framing. Source of the 044 EARS triplet (ADR-0014)."
slug: two-site-ia-044-congress-signup-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`044-product-ru.md`](./044-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · Functional-map registry row 044 (`apps/docs/content/specs/product/two-site-ia/functional-map-ru.md`). The registry row records the mechanism decisions with `file:line` evidence; this PRD is the product layer that drives the EARS triplet at `044-congress-signup/`.

## Feature summary

The congress site `orthobio.ru` (repo `doctor-school/orthobio-site`) has no sign-up form today — its call to action is an outbound link, and the repo's own rules forbid collecting personal data there («no forms, no PII»). Feature 044 is the vertical slice that changes that: a form on `orthobio.ru` submits to the platform API, which is RF-hosted and the correct receiver for personal data. What the platform does with a submission is the heart of this feature.

The owner's framing (chat, 2026-09-21) widens 044 from a narrow "write the application to a table" backend task into a full slice: «Рега на мероприятии в нашем случае должна приравниваться к регистрации на платформе. То есть заново регаться человеку не надо будет» — a congress sign-up **is** a Doctor.School account. The form creates a **passwordless** account through the shared 003 account engine (`AuthService.register` is the platform's only account door today and requires a password — a passwordless variant is new to this feature) and a registration row on the existing `registrations` table (reused from feature 020, `UNIQUE (user_id, event_id)`, no new applications table). First entry to the platform is the existing email-OTP login (`/v1/auth/login/otp`), which is also how the participant proves they own the email they typed — the form asks for no credential and no separate verification step («Если ты хочешь прийти на мероприятие, ты укажешь свою почту. Укажешь чужую - не попадёшь.»).

Because the congress is free and open to non-medics, this door skips the medical-worker declaration that the doctor-storefront (021) registration enforces: «регистрация на конгресс бесплатна и открыта даже для не-медработников». A congress-origin account simply carries no `medical-worker-declaration` consent row — the same state an Academy-origin account is already in today, so no new gate needs building elsewhere.

The slice also gives the organizing team a way to see who signed up: a restricted **event-registrar** admin role that sees only a roster (search, filter, paginate, sort) and a printable attendance sheet generated from the currently filtered view — «Пока только просмотр. Удаление по запросу будем делать вручную.» No export, no edit, no delete in this feature.

The functional map originally scoped 044 as `backend-only` with no screens of its own, reasoning that the form lives entirely on `orthobio.ru`. That framing is superseded: the admin roster and print sheet are real screens on this platform (`apps/admin`), so `surface` becomes `user-facing`. Naming drops the year — the slug is `congress-signup`, not tied to the 2026 edition, because `orthobio.ru` already promotes the 2027 congress and the mechanism this feature builds outlives any one edition.

## User stories

- **US-1** — As a **congress participant** filling out the form on `orthobio.ru`, submitting it registers me for the congress **and** gives me a Doctor.School account, with no password to set and no second registration to do later.
- **US-2** — As a **congress participant** whose email already has a Doctor.School account, submitting the form adds my congress registration to that account; the response I see is **identical** to a brand-new sign-up (no way to tell from the outside whether I already had an account), and my existing profile is **never overwritten** by what I typed on the form.
- **US-3** — As a **congress participant** who submits the form twice (double-click, retry after a slow network), I end up registered exactly once — the second submission is a no-op that looks like success, not an error and not a duplicate.
- **US-4** — As a **congress participant**, I receive a confirmation email that tells me a Doctor.School account was created for me and that I sign in with a one-time code, not a password.
- **US-5** — As a **congress participant** entering the platform for the first time, I request and enter a one-time code sent to the email I registered with; that first successful login is also what proves the email is really mine.
- **US-6** — As a **signed-in platform doctor**, I can register for the same congress from the platform's own event feed (a published event with `participationFormat: offline`), and I land in the same roster as someone who signed up on `orthobio.ru`.
- **US-7** — As a **congress participant**, I must tick a personal-data consent checkbox linked to a static consent page on the congress site before I can submit; the accepted text's version is recorded against my registration. Unlike the doctor-storefront's registration form, this form carries **no** medical-worker declaration — the congress is open to non-medics.
- **US-8** — As an **event registrar**, I open the admin roster for the congress and can search it, filter it, page through it and sort it by column; I can see every registration but I cannot edit or delete anything, and I am refused everywhere else in the admin app.
- **US-9** — As an **event registrar**, I print an attendance sheet built from the roster **as currently filtered** — the sheet reflects whatever search/filter state I had on screen.
- **US-10** — As a **congress participant**, the fields the form asks for (surname, first name, optional patronymic, phone, email, specialty, workplace, city, region, plus consent) are stored on **my registration**, not silently merged into an existing profile; if the form creates a new account, that new account is prefilled from what I typed, but an existing account's own profile fields are left exactly as they were.
- **US-11** — As a **congress participant** picking a specialty, I search a proper list of the platform's medical specialties or pick an explicit «Другое / не медицинский работник» option — I never have to type my specialty as free text.
- **US-12** — As a **congress participant**, the form is protected against bots (a visible captcha challenge) and against submission floods, the same way the platform's other public forms are.
- **US-13** — As a **congress participant**, if the platform's confirmation email happens to fail to send, my registration and my account still exist — a delivery hiccup never costs me my spot or forces me to resubmit.

## Flows

**New participant signs up on `orthobio.ru` (US-1, US-4, US-7, US-10, US-11, US-12):**

1. A visitor on `orthobio.ru` opens the congress sign-up form and fills in the required fields (surname, first name, phone, email, specialty via the searchable taxonomy select or «Другое / не медицинский работник», workplace, city, region) plus the optional patronymic, and ticks the personal-data consent checkbox linked to the static consent page.
2. A captcha challenge and request throttling guard the submission.
3. The form posts to the platform API. The API creates a passwordless Doctor.School account (through the 003 engine's new passwordless path), stores the typed answers on a new `registrations` row for the congress event, and records the accepted consent's version.
4. The participant receives a confirmation email naming the created account and explaining that they sign in with an emailed one-time code — no password is ever set or sent.
5. The sign-up response the participant sees is generic ("you're registered") — it never discloses whether an account already existed for that email.

**Existing-email participant (US-2, US-3):**

1. The same form, submitted with an email that already has a Doctor.School account (from any origin — Academy, doctor storefront, or a prior congress sign-up).
2. The API adds the congress registration to that existing account and records the consent; it does **not** touch any existing profile field (name, phone, specialty, etc.) with what was typed on the form — those answers live only on the registration row.
3. The response is identical to the new-account case (US-1's step 5) — no enumeration signal either way.
4. A second submission of the same form by the same email (retry, double-click) hits the same idempotent path: the registration already exists, so the outcome is the same success response with no duplicate row and no duplicate email.

**First platform entry (US-5):**

1. Some time after registering, the participant wants to actually use the platform (e.g., to see their ticket) and requests a login code by email.
2. They enter the code from the confirmation channel; the login succeeds, and this is the same act that proves they own the email — no separate email-verification step exists or is needed before this.

**Signed-in doctor registers from the platform feed (US-6):**

1. A doctor already signed in to `doctor.school` finds the same congress in their event feed (published, `participationFormat: offline`) and registers through the existing 020 registration path.
2. The registration lands in the same `registrations` table, on the same roster the registrar sees — no separate "platform-origin" roster.

**Registrar views and prints the roster (US-8, US-9):**

1. A user with the restricted `event-registrar` role signs in to `apps/admin` and opens the congress roster — the only section this role can see.
2. They search, filter (e.g., by specialty or city), paginate and sort the list; the role has no create/edit/delete affordance anywhere in the admin app, and any attempt to reach another admin section is refused.
3. From the currently filtered view, they print an attendance sheet — the printed rows match what was on screen at the time.

**Branches:**

- **Email-delivery failure** — the confirmation email fails to send after the registration and account are already stored; the registration is not rolled back, retried synchronously, or blocked on the send. The participant can still request a login code later even if the confirmation email never arrived (US-13).
- **Repeat submission mid-flight** (two tabs, slow network double-submit) — resolved by the same idempotent path as US-3; no duplicate registration, no duplicate account, no second email guaranteed (at most one confirmation is the intent; exact de-duplication of the email send itself is an implementation detail of the EARS triplet, not a product decision here).
- **A signed-in doctor without a `medical-worker-declaration` consent row registers** (either because their account is congress-origin or Academy-origin) — this is not a new state to handle; both doctor-storefront (021) and other doors already tolerate accounts without that row, and the congress event registration path does not require it.

## Product acceptance criteria

- Submitting the `orthobio.ru` form with a **new** email creates exactly one Doctor.School account (no password set) and exactly one registration row for the congress event; submitting it with an email that **already has** an account adds the registration to that account and changes **no** existing profile field.
- The sign-up response is **identical** regardless of whether the email already had an account — no enumeration.
- Resubmitting the same form with the same email — deliberately or by accident — never creates a second account or a second registration; the outcome each time looks like the first success.
- The typed answers (surname, first name, patronymic, phone, email, specialty, workplace, city, region) are stored **on the registration**, which is what the roster and the printed sheet display; a **newly created** account is prefilled from them, but they are never written into an existing account's own profile fields.
- The typed phone number is a **contact** phone on the registration; it is never written into `users.phone` (the platform's UNIQUE, verified, login-identifying phone column) — a collision there would either refuse the registration or silently attach it to the wrong account, neither acceptable.
- Specialty is chosen from a searchable list over the platform's specialty taxonomy, with an explicit «Другое / не медицинский работник» option; the field never accepts free text.
- Patronymic is optional; every other listed field is required.
- The personal-data consent checkbox is mandatory to submit; the version of the consent text the participant accepted is recorded against the registration. This form asks for **no** medical-worker declaration.
- A congress-origin account has no `medical-worker-declaration` consent row, and nothing elsewhere in the platform treats that absence as an error for this account (it is already the normal state for an Academy-origin account).
- First login for a congress-origin account is the existing email one-time-code flow; that successful login is also what establishes the email is genuinely reachable by the participant — no separate "confirm your email" step gates registration or first login.
- A signed-in doctor can register for the same congress event from the platform's own feed when it is published with `participationFormat: offline`, and that registration lands in the same roster as a form-origin one.
- The `event-registrar` admin role sees **only** the congress roster section; it is denied everywhere else in `apps/admin`, and within the roster it can search, filter, paginate and sort, but never create, edit, or delete a registration.
- A printable attendance sheet is produced from the **currently filtered** roster view.
- The public form is protected by a bot-detection challenge and by submission-rate throttling, consistent with the platform's other public-facing forms.
- A failure to send the confirmation email never loses, blocks, delays the HTTP response for, or requires a resubmission of the underlying registration.
- `surface: user-facing` — the feature's own screens (admin roster, print sheet) live on this platform even though the intake form itself is hosted on `orthobio.ru`.

## Approved-mockup reference

The admin roster reuses the owner-approved admin Stage-A baseline: spec 012 EARS-18 (`012-requirements-en.md:203`), covering the tabbed Refine compositions and `@ds/design-system` blocks already approved in #1282/#1337/#1578/#1605 — no fresh canvas or option round is needed for the roster's list/search/filter/pagination shell.

The **printable attendance sheet** and the **confirmation email** are approved (owner Stage-A, 2026-09-21, #2287 issuecomment-5756369423): the print sheet is a full copy of the currently filtered and sorted roster, carrying every roster column except the email-send status, with no signature column; the confirmation email is a copy in the shape of the platform's existing notice emails (`apps/api/src/mailer/notice-emails.ts`), its exact text recorded in `044-requirements-en.md` EARS-13.

Every roster column is sortable and filterable — owner, verbatim: «Сортировка и фильтрация должна быть по всем полям вообще».

The intake **form's look on `orthobio.ru`** is owned by the sibling repository's own Issue, `doctor-school/orthobio-site#78` — that repo's design process, not this PRD, settles it.

## Out of scope

- **Implementation** — this PRD is the product layer; the EARS triplet and code follow it.
- **CSV/export** — owner, verbatim: «пока, наверное, этого не делаем». The printable sheet from the filtered roster is the v1 output; no separate export mechanism.
- **Admin edit/delete** — owner, verbatim: «Пока только просмотр. Удаление по запросу будем делать вручную.» The registrar role is read-only; any deletion is a manual, out-of-band action by the team, not a feature of this admin surface.
- **The congress microsite on the platform** — feature **026** (the congress "front" on `doctor.school`) is a separate feature; this PRD owns the intake and the roster, not a platform-hosted congress landing page.
- **Event constructor** — feature **041** (the admin tool that builds out congress programs, sessions, speakers, etc.) is separate; this feature only registers people for an event that already exists.
- **Historical-base migration** — feature **043** owns migrating the previous operator's historical congress registrations; this feature only handles new registrations going forward.
- **An email confirmation step before the sign-up counts** — owner, verbatim: «Если ты хочешь прийти на мероприятие, ты укажешь свою почту. Укажешь чужую - не попадёшь.» The registration is created immediately on submission; there is no pending/unverified state to confirm out of.

## Open questions

None remain. The confirmation-email copy and the print-sheet layout are the owner Stage-A choices recorded above in «Approved-mockup reference» (#2287 issuecomment-5756369423, 2026-09-21). The published consent text is used as provided — owner, verbatim: «В согласии уже всё написано» — this PRD makes no legal conclusion about the data operator or the text's scope. The consent version identifier is confirmed as the publication date plus the sha256 of the page text (ADR-0009 §2.1).

## Prior art — source system

There is no legacy counterpart on the platform side for this intake — feature 044 is a first build, not a migration of an existing mechanism.

The congress site `orthobio.ru` has no form today: its call to action is an outbound link (Telegram/email), and the repo's own rules explicitly forbid collecting personal data there («no forms, no PII»). Changing that — adding the form itself, and loosening the site's currently maximally locked-down CSP (`form-action 'none'`) so it can submit anywhere — is owned by the sibling repository's Issue, `doctor-school/orthobio-site#78`; the receiver of that submission, RF-hosted, is this platform.

Historical congress registrations kept by the previous operator are a distinct concern, feature **043** (migration), not this one — 044 only ever handles registrations submitted through the new form going forward.

**Relevant ADRs:** ADR-0014 §1–2 (product-to-EARS pipeline this PRD feeds); ADR-0016 §1 (one person is one entity — the passwordless-account and existing-account paths both preserve this) and §7 (consents); ADR-0009 §2.1 (consent versioning); ADR-0001 §1 (coarse roles added incrementally as features arrive — `event-registrar` is one such incremental addition).
