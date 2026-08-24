---
title: "Feature 021 — Doctor registration & consents (PRD)"
description: "Product requirements for the doctor storefront's registration surface: a deliberately soft sign-up (email + password, no documents at the door) that keeps the context a doctor came from, a mandatory «I am a medical worker» checkbox gating restricted content, purpose-separated and provably recorded consents, visible partner/medrep attribution when the doctor arrives by promo code or personal link, marketing-list opt-in handed to the external mailer, starting attention points, and a return to the point of interest instead of the account page. A re-spec of a flow already live in production (the IdP keeps credential authority); source of the 021 EARS triplet (ADR-0014)."
slug: two-site-ia-021-doctor-registration-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`021-product-ru.md`](./021-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 1** (017 + 018 + 019 + 020 + 021 — the doctor storefront from entry to taking part in an event). 021 is `blocked_by` **017** (the `apps/doctor` shell and its entry point) and **020** (the event page — the funnel loses its meaning without a destination to return to). It reuses feature **003** (authentication: Zitadel IdP, email + password, email confirmation) and **005** (event registration) rather than re-specifying them.

## Feature summary

Registration is never why a doctor came. They came for an эфир, a lesson, a congress ticket — and hit a gate. Feature 021 specifies that gate's other side on the **doctor storefront** (`doctor.school`, `apps/doctor`): the shortest honest form that gets a practising physician past it and **back to exactly what they were looking at**.

This is a **re-spec of a flow that already runs in production**, not a new one. Sign-up, email confirmation and login-by-code exist today and are operated by the Zitadel IdP (feature 003); **credential authority stays there** and 021 redesigns no part of authentication. What 021 owns is the **product surface** of the doctor storefront's entry: which fields are asked, which consents are taken and how they are recorded, what the doctor is told, where they land afterwards, and what they are given for arriving.

Four product deltas separate this surface from the sign-up form the platform has today.

**A mandatory «I am a medical worker» checkbox** (CON-11). Advertising of prescription drugs and of devices requiring special training may only be shown to confirmed medical workers; the open circuit reachable with a confirmed email carries none of that content. The checkbox is the access mechanism the owner settled on — there is no «ask later» and no «ask only for part of the content» variant. It is not document verification: documents are never requested at the door (REQ-22), they live in the account (feature 022, storage and statuses in 037).

**Purpose-separated consents, provably recorded** (REQ-34). Sharing a doctor's professional data with partners is not an optional extra of the model, so the consent to it is **mandatory** — but it is stated in plain words with its exact data composition (name, specialty, city, place of work — **no contact details**), separately from the optional marketing opt-in, and each is recorded with its date. The product deliberately offers **no self-service «withdraw consent» toggle**: a withdrawal is a whole-account case handled by a platform manager by hand. Why the exchange exists is background for the designer — the interface says only that education is free for the doctor.

**Visible attribution** (REQ-39). A doctor who arrives on a partner's promo code or a medical representative's personal link is registered **with that attribution shown on the screen**, not silently tagged in the background. A doctor who arrived on their own sees the same form without it.

**Return to the point of interest** (owner edit R2 №1). Confirming the email returns the doctor to the lesson, эфир or ticket they came from — not to the account page. «To my account» stays a secondary action. A direct arrival with nothing to return to is a first-class state, not an edge case.

On top of that the surface **credits starting attention points** (REQ-49) and motivates profile completion by what it unlocks — certificates and НМО — rather than by nagging, and it hands a doctor who opted in to the **external mailing service** (REQ-115; the integration mechanics are feature 042). One account works on both storefronts (REQ-95): there is no separate Academy sign-up to be found here.

## User stories

- **US-1** — As a **guest doctor stopped by a content gate**, I register right where I hit it, in a form short enough that I do not abandon what I came for.
- **US-2** — As a **doctor**, I sign up with an email and a password and nothing else — no diploma, no СНИЛС, no document upload at the door.
- **US-3** — As a **doctor mid-way to an эфир or lesson**, the screen tells me what I will get back to, so registering does not feel like losing my place.
- **US-4** — As a **doctor**, after confirming my email I land back on the exact lesson, эфир or ticket I came from, not on an account page I did not ask for.
- **US-5** — As a **doctor arriving directly**, with nothing to return to, I still finish registration and land somewhere sensible instead of on a broken return.
- **US-6** — As a **doctor**, I am asked to confirm I am a medical worker, and I am told plainly that this is a legal requirement for part of the materials — not left guessing why a checkbox blocks me.
- **US-7** — As a **doctor**, the consent to share my professional data with partners states exactly what is shared and that my contact details are not, so I am agreeing to something specific rather than to a legal wall.
- **US-8** — As a **doctor**, the mandatory access conditions and the optional marketing opt-in are **visually distinguishable**, so I never mistake one for the other.
- **US-9** — As a **doctor**, the newsletter opt-in is genuinely optional and I can complete registration without it.
- **US-10** — As a **doctor**, my consents are recorded separately and with a date, and I am told how to change or withdraw them — through a platform manager, since the product offers no self-service toggle.
- **US-11** — As a **doctor who arrived on a partner's promo code or a medical representative's link**, the screen shows me who brought me here instead of tagging me invisibly.
- **US-12** — As a **partner's medical representative**, a doctor who came through my personal link is attributed to me at the moment of registration, so my referrals are countable.
- **US-13** — As a **doctor**, I am credited starting attention points for registering, and I am told what completing my profile adds and what it unlocks.
- **US-14** — As a **doctor short of points in front of an эфир I clearly intend to attend**, the barrier does not stop me — the minimum barrier to a live event is the point of the policy.
- **US-15** — As a **doctor**, when I mistype my email, reuse one already registered, or choose too short a password, the error tells me **what to do**, in the field where it happened.
- **US-16** — As a **doctor who has not ticked a mandatory box**, the submit button is disabled **and says why next to it** — a silently dead button is never acceptable.
- **US-17** — As a **doctor who already has an account**, the screen recognises that case and offers sign-in rather than dead-ending me on «this email is taken».
- **US-18** — As a **doctor whose submission fails on the network**, what I typed survives and I can retry without refilling the form.
- **US-19** — As a **doctor**, my one account works on both `doctor.school` and the Academy; I never register twice and never look for a separate Academy sign-up here.
- **US-20** — As a **doctor on a phone**, the whole form, its checkboxes, its errors and the return context work at 390 as well as at 1440 — most of the audience arrives from mobile.
- **US-21** — As a **doctor who opted in to the newsletter**, I am added to the mailing base automatically with my segmentation, and stopping the letters stops them everywhere.
- **US-22** — As a **product owner**, the fields, checkboxes, buttons and error texts on this screen are the shared design-system primitives and the split-screen of the existing `auth` canvas — this surface adds no private copy of a form.

## Flows

**Register from a gate (US-1, US-2, US-3, US-4, US-6, US-7, US-8, US-9, US-13):**

1. A guest doctor presses «Участвовать» on an event (020), or opens a gated lesson, or reaches a congress ticket → they arrive at the registration screen with the **return context carried along**.
2. The screen states the soft terms («email and password — that is enough; no documents at the door») and shows **what they will get back to**.
3. They fill in email and password, optionally a promo code, then tick the **mandatory** medical-worker box and the **mandatory** partner-data consent; the **optional** newsletter box is visually set apart from both.
4. Submit → «letter sent, confirm your email» (the state carried by the `auth` canvas).
5. They confirm the email → the success state: **starting points credited**, a line on what completing the profile adds (certificates and НМО), and the **return to the point of interest** as the primary action; «to my account» is secondary.
6. Back on the event/lesson/ticket, the action that was gated proceeds — registration for the event is feature 005, it is not re-implemented here.

**Register on a partner's link or promo code (US-11, US-12):**

1. The doctor follows a medical representative's personal link, or types a promo code into the form.
2. The screen shows the attribution in plain words («you came via a representative of Партнёр А»); the same form without a partner renders without that line.
3. Registration completes with that attribution attached to the account — per-representative attribution (REQ-114 refines REQ-39); how it is reported to the partner is the partner cabinet's job, not this screen's.

**Register directly (US-5):**

1. The doctor opens the registration route with no gate behind it → the return-context element is absent, not empty.
2. Registration completes and the doctor lands on a defined default destination rather than a dead return. _(Which destination — see Open questions.)_

**Not enough points in front of an event (US-14):**

1. A registered doctor with insufficient points reaches an эфир they intend to attend, especially having arrived on a partner's link to that very эфир.
2. The policy admits them **on advance**, to be worked off later (profile, lessons).
3. The advance rules and the point values themselves are an **open owner fork** — see Open questions; nothing about them is decided by this PRD.

**Consent lifecycle (US-10, US-21):**

1. Each consent is recorded separately, by purpose, with its date, and is presented as changeable **through a platform manager**.
2. A doctor who opted in to the newsletter is handed to the external mailing service with their segmentation attributes; unsubscribing there and withdrawing here stay in sync (REQ-115; mechanics in 042).
3. Any refusal or withdrawal of the mandatory consent is a whole-account case worked by a manager by hand — the interface carries **no toggle** for it.

**Branches:**

- **The email is already registered** → the field error offers sign-in rather than restating the obstacle (US-17).
- **A mandatory box is unticked** → the button is disabled and the reason sits next to it (US-16).
- **Submission fails (server unreachable)** → what was typed survives and the doctor retries (US-18).
- **The doctor abandons after the letter is sent** → confirming the link later still returns them to the point of interest, for as long as that content is still there; what they see when it is not is an open question.

## Product acceptance criteria

- The doctor storefront's registration asks for **email and password only** (optionally a promo code) and requests **no documents of any kind**; document upload exists solely in the doctor's account (022 / 037), never here.
- A **mandatory «I am a medical worker» checkbox** is a precondition of registration, carries a plain explanation of why, and has no «ask later» form. It is a declaration, not verification — it opens the REQ-20 circuit, while content requiring confirmed medical-worker status stays gated on the verification specified elsewhere (CON-11, REQ-22).
- A **mandatory partner-data consent** states its exact composition — name, specialty, city, place of work — and states that **contact details are not shared**.
- A **separate, genuinely optional newsletter consent** exists, and registration completes without it.
- Mandatory access conditions and the optional marketing opt-in are **visually distinguishable**, not distinguished by wording alone.
- Consents are **separate by purpose and recorded provably with a date**; the interface presents change/withdrawal as a manager-handled request and offers **no self-service withdrawal toggle**.
- No interface copy anywhere on this surface states **who pays** for the doctor's education; the surface says only that it is free for the doctor.
- When the doctor arrived on a partner's promo code or a medical representative's personal link, the **attribution is visible on the screen** and is attached to the resulting account; without one, the same screen renders with no attribution element.
- After email confirmation the doctor is **returned to the point of interest** they came from, with «to my account» as a secondary action; the account page is never the default outcome of registration.
- A registration with **no return context** completes and lands on a defined destination — no empty return element, no dead link.
- **Starting points are credited for registering**, and the success state names what completing the profile adds and what it unlocks (certificates, НМО). The concrete values and the advance policy are not fixed by this PRD (Open questions).
- Every error state is **actionable in the field where it occurred** — malformed email, already-registered email, too-short password — and a disabled submit button **always states its reason next to it**.
- A failed submission **preserves what the doctor typed**.
- Registration produces **one account that works on both storefronts** (REQ-95); this surface offers no separate Academy sign-up and no account-type choice («doctor / expert») — roles are attributes of one account (ADR-0016 §1).
- Credentials, email confirmation and session issuance stay with the **IdP (feature 003)**; 021 changes no authentication mechanism, adds no social login, and specifies no password policy of its own beyond surfacing the IdP's rules as field errors.
- A doctor who opted in is handed to the **external mailing service** with their segmentation attributes, and consent withdrawal propagates (REQ-115; the integration itself is 042).
- The screen works at **390 and 1440**, in light and dark, with the field, focus and validation states of the design system; the split-screen geometry and the sent/confirmed states come from the existing `auth` canvas rather than being invented here.
- The surface meets the platform's accessibility bar for a public page (the `playwright-axe` gate): every checkbox a real labelled control, every error programmatically tied to its field, the disabled-submit reason readable by a screen reader.
- Nothing that feature 003 runs in production regresses — 021 re-specifies the doctor-storefront entry surface, not the authentication engine behind it.

## Out of scope

- **Authentication itself** — the IdP, password storage, email-confirmation delivery, login-by-code, password reset and session management are feature **003**, live in production.
- **Event registration proper** — what happens after the doctor returns to the эфир is feature **005**.
- **The doctor's account** — profile completion, document upload, verification statuses, the points balance display: feature **022** (with storage/statuses in **037**).
- **The points engine** — accrual rules, the append-only ledger, spending and the advance mechanics belong to the accruals feature (**025**); 021 only states that registration credits something and shows it.
- **The mailing integration** — the connector that feeds the external service is feature **042**; 021 owns only the consent that triggers it.
- **Document verification** and everything OWD-12 leaves open (what is stored, for how long, who sees it) — not asked at the door, not decided here.
- **The partner cabinet and per-representative reporting** — 021 attaches the attribution, it does not report on it.
- **Any Academy-side registration or the Academy's own entry surfaces** — one account, one sign-up (REQ-95).
- **Analytics on funnel conversion** and any A/B machinery for this form.

## Open questions

- **REQ-49 accrual — an open owner fork, not a decision.** How many points registration credits, how many profile completion adds, and on what conditions a doctor short of points is admitted **on advance** to an event they clearly intend to attend (and how that advance is worked off) are **owner calls that remain open**. The prompt's draft copy («+20 Pul», «+30 Pul for the profile») is placeholder text, not a product decision, and the naming of the point unit in the interface is an owner copy decision alongside it. _Owner pick: PENDING._
- **Where a direct registration lands** when there is no point of interest to return to — the specialty feed (018), the storefront home (017), or the account (022).
- **How long a return context survives.** A doctor who confirms the letter days later returns to content that may have started, ended or been unpublished; what they see then is unresolved.
- **Whether the promo code is a form field at all**, or attribution arrives only by link. The canvas draws the field; whether a doctor ever types a code by hand is an owner call.
- **Whether an identifier other than email is accepted at registration.** The `auth` canvas carries phone validation on its sign-in path; REQ-23 fixes email + password for registration, and whether phone is ever an alternative here is not settled.
- **What refusing the mandatory consent looks like in the funnel.** REQ-34 makes refusal a whole-account manager case; whether a doctor who declines at registration is shown anything beyond «registration is not possible without it» is unresolved.

## Approved-mockup reference

The screen is drawn on the re-cut **`auth` canvas**, vendored at [`design-source/auth.dc.html`](../../../../../../design-source/auth.dc.html) (owner-drawn, vendored under [#1450](https://github.com/doctor-school/ds-platform/issues/1450); the corresponding prompt is [`07-d-register-ru.md`](../../product/two-site-ia/design-prompts-ru/07-d-register-ru.md)). It is a **re-cut of an existing canvas, not a new screen**: the split-screen geometry, the field, focus and validation states, and the «letter sent» / «email confirmed» states are taken from the base unchanged; the event card in the split's left half is `webinar-card.dc.html` as-is, and the points plate is the shared unit whose anatomy is owned by `05-d-lesson`.

**Canvas defaults are the working assumption; the Stage-A pick is this PRD's fork table.** Every composition resolution is read off the vendored file, never off this PRD's prose.

| #   | Fork                                             | Canvas options                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Canvas default                               | Owner pick |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------- |
| 1   | **How the mandatory consent block is presented** | **А** — flat checkbox list (as in the R4 layout): honest and compact, but three checkboxes in a row read as fine print. **Б** — two levels: access conditions (medical worker + partner data) framed above the button, the marketing opt-in separately below; separates the meanings, lengthens the form. **В** — expandable data composition: one consent line plus a «what exactly is shared» disclosure; shorter, but hides something material — risky for provability. | **А** (`consentVariant`)                     | `PENDING`  |
| 2   | **Where the return context lives**               | **А** — a line above the form («you will return to …»). **Б** — the left half of the split, with the card of the content the doctor is registering for; holds the intent harder, and the canvas draws its mobile treatment as a background plate above the form at 390.                                                                                                                                                                                                    | **А** (`returnVariant`)                      | `PENDING`  |
| 3   | **How starting points are shown**                | On the **success state** after email confirmation only — or **also promised on the form** («+N for registering»); the promise motivates but adds a reward element the R4 layout does not carry.                                                                                                                                                                                                                                                                            | **success state only** (`promisePoints` off) | `PENDING`  |

**Content-driven states, not design options** — these canvas switches are the states the built screen must render, and they are not owner picks: arrived **from a gate** vs **directly** (`fromGate`, default on), arrived **on a partner link** vs **on their own** (`partnerLink`, default off), and the form states empty / filled-and-valid / field errors / network failure (`formState`, default empty). The composition switcher in the canvas is a design-review aid and is not built.
