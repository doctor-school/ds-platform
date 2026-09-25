---
title: "Feature 044 — Congress sign-up (PRD)"
description: "Product requirements for the congress sign-up vertical slice: the public intake form on orthobio.ru (repo doctor-school/orthobio-site), the platform API that turns a submission into a registration AND a passwordless Doctor.School account, a restricted admin roster bound to one event that works as the registration desk at the congress, and a confirmation email. Source of the 044 EARS triplet (ADR-0014)."
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

044 is a full slice, not a "write the application to a table" backend task: «Рега на мероприятии в нашем случае должна приравниваться к регистрации на платформе. То есть заново регаться человеку не надо будет» — a congress sign-up **is** a Doctor.School account. The form creates a **passwordless** account through the shared 003 account engine (`AuthService.register` is the platform's only account door today and requires a password — a passwordless variant is new to this feature) and a registration row on the existing `registrations` table (reused from feature 020, `UNIQUE (user_id, event_id)`, no new applications table). First entry to the platform is how the participant proves they own the email they typed: they request a login code, and because that email has never been confirmed before, the platform sends a confirmation code instead — entering it confirms the email. Requesting a code again then completes the actual sign-in; every entry after that is the plain one-code login (`/v1/auth/login/otp`). The form itself asks for no credential and gates nothing on confirmation — registration is complete the moment the form is submitted («Если ты хочешь прийти на мероприятие, ты укажешь свою почту. Укажешь чужую - не попадёшь.»).

Because the congress is free and open to non-medics, this door skips the medical-worker declaration that the doctor-storefront (021) registration enforces: «регистрация на конгресс бесплатна и открыта даже для не-медработников». A congress-origin account simply carries no `medical-worker-declaration` consent row — the same state an Academy-origin account is already in today, so no new gate needs building elsewhere.

The slice also gives the organizing team a way to see who signed up: a restricted **event-registrar** admin role that sees only a roster (search, filter, paginate, sort) — «Пока только просмотр. Удаление по запросу будем делать вручную.» No export, no edit, no delete in this feature.

044 is `user-facing`: the admin roster, the participant card and the manual-registration form are real screens on this platform (`apps/admin`), even though the intake form itself lives on `orthobio.ru`. The slug is `congress-signup`, not tied to the 2026 edition, because `orthobio.ru` already promotes the 2027 congress and the mechanism this feature builds outlives any one edition.

Sign-up is open only inside a **registration window**. It opens on 1 October 2026 at 00:00 Moscow time; the closing instant currently stands at 1 January 2027, 00:00 Moscow time as a provisional value the product owner replaces with the real closing date-time before launch. The window binds the congress-site form only — a doctor registering from the platform's own event feed follows the event's own rules. It is a constant of this congress in the platform's own code — there is no admin screen for it and no seat limit of any kind. Outside the window the congress site shows «Регистрация откроется ДД.ММ в ЧЧ:ММ (мск)» or «Регистрация на конгресс закрыта» and no form, and the API refuses a submission that reaches it anyway before anything at all is created.

Two registrations of the same congress can legitimately carry the same phone — a colleague signing a second person up from one number, a clinic's shared line. The platform never refuses or merges them: it **marks** them «возможный дубль» for the registrar, who decides. The marker is computed from the registrations themselves each time the roster is read, so once the team removes one of them on request the other stops being marked.

**Production amendment — registration desk (2026-09-25, #2377).** The printed sheet (#2291) never shipped and is cancelled: «печатный лист #2291 отменяем - рабочей админки достаточно». The product owner turned the running view-only roster into a working registration desk at the congress itself: the registrar is bound to one event and sees neither other events nor other admin sections; marks a participant's attendance separately for each congress day (23 and 24 April 2027), with who marked it and when recorded by the platform's existing change audit; enters walk-ins who never signed up on the site — they get the same account and the same email, and the registrar ticks the consent signed on paper; opens a participant card with all the data, while the table shrinks to №, ФИО, специальность, город, телефон, дата регистрации, присутствие. Sort now covers the visible columns and attendance; workplace, region, email and mail status move into the card and stay filterable but not sortable — a narrowing of «сортировка и фильтрация по всем полям», since the card carries those fields. The view-only roster described above and in US-8 is the running-production baseline this amendment extends; it rescopes the open Issues #2313, #2316, #2317, #2318, #2319 and their parents #2289, #2290, which the tech lead re-grades after it merges.

## User stories

- **US-1** — As a **congress participant** filling out the form on `orthobio.ru`, submitting it registers me for the congress **and** gives me a Doctor.School account, with no password to set and no second registration to do later.
- **US-2** — As a **congress participant** whose email already has a Doctor.School account, submitting the form adds my congress registration to that account; the response I see is **identical** to a brand-new sign-up (no way to tell from the outside whether I already had an account), and my existing profile is **never overwritten** by what I typed on the form.
- **US-3** — As a **congress participant** who submits the form twice (double-click, retry after a slow network), I end up registered exactly once — the second submission is a no-op that looks like success, not an error and not a duplicate.
- **US-4** — As a **congress participant**, I receive a confirmation email that tells me a Doctor.School account was created for me and that I sign in with a one-time code, not a password.
- **US-5** — As a **congress participant** entering the platform for the first time, I request a login code and am sent a confirmation code instead, because that email has never been confirmed before; entering it confirms my email, and requesting a code again lets me actually sign in. From then on, signing in is always the plain one-code flow.
- **US-6** — As a **signed-in platform doctor**, I can register for the same congress from the platform's own event feed (a published event with `participationFormat: offline`), and I land in the same roster as someone who signed up on `orthobio.ru`.
- **US-7** — As a **congress participant**, I must tick a personal-data consent checkbox linked to a static consent page on the congress site before I can submit; the accepted text's version is recorded against my registration. Unlike the doctor-storefront's registration form, this form carries **no** medical-worker declaration — the congress is open to non-medics.
- **US-8** — As an **event registrar**, I open the admin roster for the congress and can search it, filter it, page through it and sort it by column; I can see every registration but I cannot edit or delete anything, and I am refused everywhere else in the admin app.
- **US-10** — As a **congress participant**, the fields the form asks for (surname, first name, optional patronymic, phone, email, specialty, workplace, city, region, plus consent) are stored on **my registration**, not silently merged into an existing profile; if the form creates a new account, that new account is prefilled from what I typed, but an existing account's own profile fields are left exactly as they were.
- **US-11** — As a **congress participant** picking a specialty, I search a proper list of the platform's medical specialties or pick an explicit «Другое / не медицинский работник» option — I never have to type my specialty as free text.
- **US-12** — As a **congress participant**, the form is protected against bots (a visible captcha challenge) and against submission floods, the same way the platform's other public forms are.
- **US-13** — As a **congress participant**, if the platform's confirmation email happens to fail to send, my registration and my account still exist — a delivery hiccup never costs me my spot or forces me to resubmit.
- **US-14** — As a **congress participant**, I can submit the sign-up form only while registration is open; before it opens I am told when it opens, and after it closes I am told that registration is closed — in both cases there is no form to fill in and nothing I submit is accepted.
- **US-15** — As an **event registrar**, I see which registrations share a contact phone with another registration for the same congress, marked «возможный дубль» in the roster and in the participant card, so that I can decide whether it is a real duplicate; once I have one of them removed on request, the other stops being marked.
- **US-16** — As an **event registrar** bound to one congress, I work the registration desk: I find a participant, open their card with all their data, mark that they came, separately for each congress day, and enter into the base someone who came without a site sign-up — with the same account and email as the site form, and with the consent signed on paper; I see no other events and no other admin sections (amendment 2026-09-25, #2377).

## Flows

**New participant signs up on `orthobio.ru` (US-1, US-4, US-7, US-10, US-11, US-12):**

1. Registration is open: the visitor arrives between the opening and the closing instant, so `orthobio.ru` shows the form rather than a window notice. A visitor on `orthobio.ru` opens the congress sign-up form and fills in the required fields (surname, first name, phone, email, specialty via the searchable taxonomy select or «Другое / не медицинский работник», workplace, city, region) plus the optional patronymic, and ticks the personal-data consent checkbox linked to the static consent page.
2. A captcha challenge and request throttling guard the submission.
3. The form posts to the platform API. The API creates a passwordless Doctor.School account (through the 003 engine's new passwordless path), stores the typed answers on a new `registrations` row for the congress event, and records the accepted consent's version.
4. The participant receives a confirmation email naming the created account and explaining that they sign in with an emailed one-time code — no password is ever set or sent.
5. The page confirms that the registration has been accepted, tells the participant that a confirmation email has been sent to the address they gave, and states that nothing more is required of them. That confirmation is generic — it never discloses whether an account already existed for that email.

**Existing-email participant (US-2, US-3):**

1. The same form, submitted with an email that already has a Doctor.School account (from any origin — Academy, doctor storefront, or a prior congress sign-up).
2. The API adds the congress registration to that existing account and records the consent; it does **not** touch any existing profile field (name, phone, specialty, etc.) with what was typed on the form — those answers live only on the registration row.
3. The response is identical to the new-account case (US-1's step 5) — no enumeration signal either way.
4. A second submission of the same form by the same email (retry, double-click) hits the same idempotent path: the registration already exists, so the outcome is the same success response with no duplicate row and no duplicate email.

**First platform entry (US-5):**

1. Some time after registering, the participant wants to actually use the platform (e.g., to see their ticket) and requests a login code by email.
2. Because that email has never been confirmed before, the platform sends a confirmation code instead of a login code; entering it confirms the email but does not sign the participant in.
3. The participant requests a code again — this time it is the login code — and entering it signs them in. From then on, every sign-in is the plain one-code flow.

**Signed-in doctor registers from the platform feed (US-6):**

1. A doctor already signed in to `doctor.school` finds the same congress in their event feed (published, `participationFormat: offline`) and registers through the existing 020 registration path.
2. The registration lands in the same `registrations` table, on the same roster the registrar sees — no separate "platform-origin" roster.

**Registrar views the roster (US-8):**

1. A user with the restricted `event-registrar` role signs in to `apps/admin` and opens the congress roster — the only section this role can see.
2. They search, filter (e.g., by specialty or city), paginate and sort the list; the role has no create/edit/delete affordance anywhere in the admin app, and any attempt to reach another admin section is refused.

**Registrar at the congress registration desk (US-16, amendment 2026-09-25):**

1. A registrar bound to the congress signs in to `apps/admin` and sees only that event's roster — no other events, no other sections.
2. A participant comes to the desk; the registrar finds them by search, opens their card, checks the data and marks attendance for today's congress day. The second day takes its own mark.
3. If the participant never signed up on the site, the registrar enters their data in the manual-registration form and ticks «consent obtained on paper»; the participant gets an account and the same confirmation email as after the site form. If the email is already registered, the desk creates no second record and opens the existing card instead.
4. At any moment the registrar filters the roster by attendance on a given day.

**Branches:**

- **Outside the registration window (US-14)** — before the opening instant the congress site shows «Регистрация откроется ДД.ММ в ЧЧ:ММ (мск)» and no form; after the closing instant it shows «Регистрация на конгресс закрыта» and no form. A submission that reaches the API anyway — a stale page, a direct call — is refused with a machine-readable state saying which of the two it is, and nothing is created: no account, no registration, no consent record, no email.
- **Two registrations share a phone (US-15)** — both are accepted exactly like any other registration, and the participants see the same confirmation as everyone else; the registrar sees both marked «возможный дубль» in the roster and in their cards, and resolves it manually if it is one.
- **Email-delivery failure** — the confirmation email fails to send after the registration and account are already stored; the registration is not rolled back, retried synchronously, or blocked on the send. The participant can still request a login code later even if the confirmation email never arrived (US-13).
- **Repeat submission mid-flight** (two tabs, slow network double-submit) — resolved by the same idempotent path as US-3; no duplicate registration, no duplicate account, no second email guaranteed (at most one confirmation is the intent; exact de-duplication of the email send itself is an implementation detail of the EARS triplet, not a product decision here).
- **A signed-in doctor without a `medical-worker-declaration` consent row registers** (either because their account is congress-origin or Academy-origin) — this is not a new state to handle; both doctor-storefront (021) and other doors already tolerate accounts without that row, and the congress event registration path does not require it.

## Product acceptance criteria

- Submitting the `orthobio.ru` form with a **new** email creates exactly one Doctor.School account (no password set) and exactly one registration row for the congress event; submitting it with an email that **already has** an account adds the registration to that account and changes **no** existing profile field.
- The sign-up response is **identical** regardless of whether the email already had an account — no enumeration.
- On success the participant is told three things: the registration has been accepted, a confirmation email has been sent to the address they gave, and nothing further is required of them.
- A submission through the congress-site form is accepted only between the opening instant (1 October 2026, 00:00 Moscow time) and the closing instant, provisionally 1 January 2027, 00:00 Moscow time until the product owner gives the real one. The window binds that form only; registering from the platform's own event feed (US-6) is not bound by it. Before it opens, the congress site says when it opens; after it closes, it says registration is closed; in both cases no form is shown and a submission that reaches the API is refused before anything is created. The dates the site displays are the same instants the API enforces. There is no seat limit and no waiting list, and the window is not editable from the admin app.
- Registrations of the same congress sharing a contact phone are all accepted normally — no refusal, no merge, and the participant sees no difference — and each of them is marked «возможный дубль» in the roster and in the participant card. The mark is recomputed whenever the roster is read, so removing one of them un-marks the other. Phones typed differently («+7…», «8…», with spaces or dashes) count as the same phone. A registration made from the platform's own feed carries no form answers and is never marked.
- Resubmitting the same form with the same email — deliberately or by accident — never creates a second account or a second registration; the outcome each time looks like the first success.
- The typed answers (surname, first name, patronymic, phone, email, specialty, workplace, city, region) are stored **on the registration**, which is what the roster and the participant card display; a **newly created** account is prefilled from them, but they are never written into an existing account's own profile fields.
- The typed phone number is a **contact** phone on the registration; it is never written into `users.phone` (the platform's UNIQUE, verified, login-identifying phone column) — a collision there would either refuse the registration or silently attach it to the wrong account, neither acceptable.
- Specialty is chosen from a searchable list over the platform's specialty taxonomy, with an explicit «Другое / не медицинский работник» option; the field never accepts free text.
- Patronymic is optional; every other listed field is required.
- The personal-data consent checkbox is mandatory to submit; the version of the consent text the participant accepted is recorded against the registration. This form asks for **no** medical-worker declaration.
- A congress-origin account has no `medical-worker-declaration` consent row, and nothing elsewhere in the platform treats that absence as an error for this account (it is already the normal state for an Academy-origin account).
- First entry for a congress-origin account runs the existing email one-time-code flow twice: the first request sends a confirmation code, which the participant enters to confirm the email with no session created; the participant then requests and enters a login code to actually sign in. After that first entry, every sign-in is the plain one-code flow. Nothing about this gates registration itself — the account and registration are created the moment the form is submitted.
- A signed-in doctor can register for the same congress event from the platform's own feed when it is published with `participationFormat: offline`, and that registration lands in the same roster as a form-origin one.
- The `event-registrar` admin role sees **only** the congress roster section; it is denied everywhere else in `apps/admin`, and within the roster it can search, filter, paginate and sort, but never create, edit, or delete a registration.
- The public form is protected by a bot-detection challenge and by submission-rate throttling, consistent with the platform's other public-facing forms.
- A failure to send the confirmation email never loses, blocks, delays the HTTP response for, or requires a resubmission of the underlying registration.
- `surface: user-facing` — the feature's own screens (admin roster, participant card, manual-registration form) live on this platform even though the intake form itself is hosted on `orthobio.ru`.
- Amendment 2026-09-25 (#2377): the registrar is bound to exactly one event and sees only its roster; any data of another event, the event list and other admin sections are refused server-side; a registrar with no binding sees nothing. The binding is granted by the tech lead on the product owner's request for now.
- Attendance is marked and cleared separately for each congress day (23 and 24 April 2027); who set or cleared a mark and when is visible in the participant card from the platform's change audit; the roster filters by attendance on a chosen day.
- Manual registration of a walk-in creates the same account, the same registration and the same confirmation email as the site form, without the captcha and outside the registration window; without the paper-consent tick it does not go through; a repeat entry for the same email creates no duplicate.
- The participant card shows all stored data, the registration origin (site, desk, platform feed), the consent, the mail status, the «возможный дубль» marker and attendance per day; nothing in it can be edited or deleted.
- Roster columns: №, ФИО, специальность, город, телефон, дата регистрации, присутствие; the other fields are in the card and available as filters. Roster search works as before and is checked by a live drive.

## Approved-mockup reference

The admin roster reuses the owner-approved admin Stage-A baseline: spec 012 EARS-18 (`012-requirements-en.md:203`), covering the tabbed Refine compositions and `@ds/design-system` blocks already approved in #1282/#1337/#1578/#1605 — no fresh canvas or option round is needed for the roster's list/search/filter/pagination shell.

The **confirmation email** is approved (owner Stage-A, 2026-09-21, #2287 issuecomment-5756369423): it is a copy in the shape of the platform's existing notice emails (`apps/api/src/mailer/notice-emails.ts`), its exact text recorded in `044-requirements-en.md` EARS-13 (amended 2026-09-24, #2369: one copy for every participant, no account paragraph, no sign-in action).

Every roster column is sortable and filterable — owner, verbatim: «Сортировка и фильтрация должна быть по всем полям вообще».

The intake **form's look on `orthobio.ru`** is owned by the sibling repository's own Issue, `doctor-school/orthobio-site#78` — that repo's design process, not this PRD, settles it.

## Out of scope

- **Implementation** — this PRD is the product layer; the EARS triplet and code follow it.
- **CSV/export** — owner, verbatim: «пока, наверное, этого не делаем». The roster in the admin is the v1 output; no separate export mechanism.
- **Admin edit/delete** — owner, verbatim: «Пока только просмотр. Удаление по запросу будем делать вручную.» The registrar role is read-only; any deletion is a manual, out-of-band action by the team, not a feature of this admin surface. There is no retention period and no automatic expiry either: a registration is kept until the team removes it on request.
- **An admin-editable registration window** — the opening and closing instants are constants of this congress in the platform's code; changing them is a deploy, not a setting.
- **A capacity cap** — no seat count, no waiting list, no "sold out" state; the window is the only bound on intake.
- **The congress microsite on the platform** — feature **026** (the congress "front" on `doctor.school`) is a separate feature; this PRD owns the intake and the roster, not a platform-hosted congress landing page.
- **Event constructor** — feature **041** (the admin tool that builds out congress programs, sessions, speakers, etc.) is separate; this feature only registers people for an event that already exists.
- **Historical-base migration** — feature **043** owns migrating the previous operator's historical congress registrations; this feature only handles new registrations going forward.
- **An email confirmation step before the sign-up counts** — owner, verbatim: «Если ты хочешь прийти на мероприятие, ты укажешь свою почту. Укажешь чужую - не попадёшь.» The registration is created immediately on submission; there is no pending/unverified state to confirm out of.
- **A screen for granting the role's event binding** — #2378; until then the tech lead grants the binding on the product owner's request (owner: «Пока "вручную" запросом к тебе.»).
- **The event partner role** — feature **046** (#2379); it reuses the same binding table but is not part of this amendment.
- **Editing and deleting a participant's stored answers** — still outside the feature; the desk adds only the attendance mark and manual registration.

## Open questions

- **The final closing date-time of the registration window** — owner, before #2292. The constant currently holds the provisional 1 January 2027, 00:00 Moscow time; the API constant and the dates the congress site displays are both set from the owner's final answer, and the launch checklist verifies the two agree.

The 2026-09-25 amendment (#2377) adds no open questions: the congress days, the column set, the consent origin and the way the binding is granted are owner-decided.

The confirmation-email copy is the owner Stage-A choice recorded above in «Approved-mockup reference» (#2287 issuecomment-5756369423, 2026-09-21). The published consent text is used as provided — owner, verbatim: «В согласии уже всё написано» — this PRD makes no legal conclusion about the data operator or the text's scope. The consent version identifier is confirmed as the publication date plus the sha256 of the page text (ADR-0009 §2.1).

## Prior art — source system

There is no legacy counterpart on the platform side for this intake — feature 044 is a first build, not a migration of an existing mechanism.

The congress site `orthobio.ru` has no form today: its call to action is an outbound link (Telegram/email), and the repo's own rules explicitly forbid collecting personal data there («no forms, no PII»). Changing that — adding the form itself, and loosening the site's currently maximally locked-down CSP (`form-action 'none'`) so it can submit anywhere — is owned by the sibling repository's Issue, `doctor-school/orthobio-site#78`; the receiver of that submission, RF-hosted, is this platform.

Historical congress registrations kept by the previous operator are a distinct concern, feature **043** (migration), not this one — 044 only ever handles registrations submitted through the new form going forward.

**Relevant ADRs:** ADR-0014 §1–2 (product-to-EARS pipeline this PRD feeds); ADR-0016 §1 (one person is one entity — the passwordless-account and existing-account paths both preserve this) and §7 (consents); ADR-0009 §2.1 (consent versioning); ADR-0001 §1 (coarse roles added incrementally as features arrive — `event-registrar` is one such incremental addition).
