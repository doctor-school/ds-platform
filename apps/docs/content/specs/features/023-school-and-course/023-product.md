---
title: "Feature 023 — The school and the course (PRD)"
description: "Product requirements for the structure a doctor learns in on `doctor.school`: a direction has several schools, one per expert; a school holds courses; a course is made of modules — by default of the structure preset each module holds six lessons plus a club and is sold separately; a module holds lessons. The school screen, the course and module program view, graduate reviews, mentoring and internship at school level, partner/advertising labelling, the «start anywhere, certificate only for the whole course» rule as a preset of the 024 rules constructor, and the entry into document verification on completion. Wave 2, `blocked_by` 024; source of the 023 EARS triplet (ADR-0014)."
slug: two-site-ia-023-school-and-course-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
storefronts: doctor-only
storefronts_reason: "School and course are doctor-storefront products (#d-school, apps/doctor, functional map §B 023). The Academy has no school surface: there a school or course is a project result behind the scenes (ADR-0016 §4), and the doctor sees only the finished school on the doctor storefront."
lang: en
---

> **EN (this)** · **RU:** [`023-product-ru.md`](./023-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 2** (022, 023, 024, 025, 044). 023 is `blocked_by` **024** — the school and course are containers over the modules and lessons defined in [024](../024-learning-module-path/024-product.md), and building the container before its contents means rebuilding both. Domain canon: [ADR-0016](../../../adr/0016-core-domain-model-en.md) §4 (school, course and module are project results), §5 (a school is tied to a direction). Discovery record: Issue #1792 (owner decisions P0, D1–D9).

**Provenance legend.** **[owner]** — owner-approved: the principle P0 («a constructor, not code»), decisions D1–D9 and the five-point constructor direction the owner confirmed on 2026-11-04. **[proposed]** — `agent-proposed — UNCONFIRMED`: everything else, including every concrete setting, default value and interface element below. D4, D6 and D9 are **defaults of presets, never hard rules** [owner, P0].

## Feature summary

Doctor.School is a «school of schools». On the doctor storefront the end product a doctor chooses is a **school** — not an Academy project, which a doctor never sees (REQ-50, ADR-0016 §4). 023 defines that product and its structure:

- **Direction → school → course → module → lesson** [owner, D1]. A direction can have **several schools, one per expert**; a course always lives inside a school [owner, D2]. A lesson always lives inside a course and its module; the feed's «lesson of the day» is a lesson of a course with a link to that course [owner, D3].
- **Modules group a course's lessons.** By default of the structure preset a module is mandatory, holds six lessons plus a club that closes it, and is sold separately from its course [proposed default per D4; P0 makes it a default, not a rule]. The reference course (an ДПО block of 36 hours) is three modules × six lessons = 18 lessons + 18 podcasts + 3 clubs — an example, not a norm [proposed, from the methodology research on #1792].
- **A single-module course hides its module level** in the interface, so a short course (including the single lesson from the 033 author application) reads as a course of lessons, not as «module 1 of 1» [proposed — the constructor direction's resolution of the 033 case].

The school screen shows a school as a product of its direction: who leads it, which courses it offers and what they lead to, what graduates say (REQ-118), and what the school gives beyond lessons — **mentoring and internships as school-level functions** (REQ-119). A course page shows its **program**: modules, their lessons, the clubs, the duration in academic hours, and what document the course leads to. A course is still presented to the doctor as a **series** (REQ-16, as on the 018 feed).

The rules of how the course is walked — what opens when, what counts as done — are **not defined here**: they are the settings of the 024 rules constructor, inherited from the school and the course. 023 contributes the course-level rule from the registry, Q-7: **«урок №5 без предыдущих можно, сертификат — только за полный курс»** — a doctor may start with any episode, but the certificate requires the whole course. Under P0 this is **a preset of the constructor** (free unlock inside the course, course completion = all modules done), not a hard-coded behaviour [owner, P0; preset proposed].

On completion, a course leads to a **document**: 023 shows the doctor what the course leads to and gives the **entry into document verification**, available at any time (REQ-17, REQ-22); issuing the document is feature 038 and verification storage is 037. Partner and advertising content on a school or course page is **explicitly labelled** (REQ-66); what advertising may appear inside a lesson is the single rule stated in [024](../024-learning-module-path/024-product.md) (Product acceptance criteria, partner downloads).

## User stories

- **US-1** — As a **doctor**, I see the **schools of my direction** and understand that each is led by its own expert, so I choose a school as I would choose a teacher.
- **US-2** — As a **doctor**, I open a **school** and see who leads it, which courses it offers, what they lead to and what else the school gives — mentoring, internships.
- **US-3** — As a **doctor**, I open a **course** and see its **program**: modules, the lessons in each, the club that closes each module, the total in academic hours and the document at the end.
- **US-4** — As a **doctor**, I understand that a **module can be taken on its own** — and what I get for finishing a module versus finishing the whole course.
- **US-5** — As a **doctor**, I can **start a course from any lesson** where the course's rules allow it, and I see clearly that **the certificate needs the whole course**.
- **US-6** — As a **doctor in the middle of a course**, the course and its modules show **my progress** as computed by the rules in force, and the next step is one action away.
- **US-7** — As a **doctor**, I read **graduate reviews** of a school or course before I commit my time.
- **US-8** — As a **doctor**, I see **mentoring and internship** offers of the school and how to apply for them.
- **US-9** — As a **doctor**, any **partner or advertising material** on a school or course page is labelled as such, so I always know what is educational and what is promotional.
- **US-10** — As a **doctor finishing a course**, I see which **document** the course leads to and what I need for it, and I can **submit my documents for verification** at any time — not only at the end.
- **US-11** — As a **doctor taking a short course** of a single module, I see a course of lessons, not a «module 1 of 1» layer.
- **US-12** — As a **doctor arriving from the lesson of the day** in the feed, I land in the lesson **inside its course** and can see where it sits in the program.
- **US-13** — As a **guest**, I can read a school and a course program before registering; the screens say honestly which step needs an account.
- **US-14** — As a **school or course author (a role of the Academy)**, I set the **structure** of a course — its modules and lessons — and pick its rules **preset** from 024 (for example «start anywhere, certificate for the whole course»), with no code change.
- **US-15** — As a **doctor on a phone**, the school, course and program screens work as well as on desktop, and my progress is the same as in the mobile app.

## Flows

**Choosing a school and a course (US-1, US-2, US-3, US-7):**

1. From the specialty feed (018) the doctor opens a school → the school screen: its expert, its courses with what each leads to, graduate reviews, mentoring and internships.
2. The doctor opens a course → the program: modules with their lessons and closing club, the duration in academic hours, the document at the end, and the doctor's progress if any.
3. The doctor starts the course or a module → the learning module (024) takes over.

**Starting anywhere, certificate for the whole course (US-5, Q-7):**

1. Under the «start anywhere» preset the doctor opens lesson 5 directly → it is open.
2. The program shows lessons 1–4 as not yet done, and the document block says the certificate needs every module done.
3. When the course's completion rule is met, the document block leads to issuance (feature 038).

**Buying a module (US-4):** the doctor opens a module on its own → its price and what it unlocks are shown in the doctor's terms → the purchase itself is feature 025 [proposed]; after it, the module's lessons follow their unlock rules.

**Verification at any time (US-10):** the doctor opens «Документы» from a course → the verification entry (REQ-22) leads to the document upload of 037 → the course shows the verification status where the document requires it.

**A guest (US-13):** a guest opens a school or course → everything descriptive is readable → starting a lesson shows the registration gate (021) and returns the doctor to the same place.

## Product acceptance criteria

- **The structure is direction → school → course → module → lesson** [owner, D1]; a direction may have several schools, each led by one expert; a course belongs to exactly one school [owner, D2]; a lesson belongs to exactly one module of one course [owner, D3; direction].
- **Every course has at least one module** [owner, direction]. By default of the structure preset a module holds six lessons plus a closing club and is **sellable separately** from the course [proposed default per D4]; these are defaults, not constraints [owner, P0].
- **A single-module course hides its module level** in the doctor's interface [proposed].
- The **school screen** presents a school as the doctor's end product: its expert, its courses with what they lead to, graduate reviews (REQ-118), mentoring and internships as school-level functions (REQ-119). The word «проект» never appears in the doctor's interface (REQ-50).
- The **course program** lists modules, their lessons and closing clubs, the duration in academic hours and the document at the end; a course keeps its **series** framing with the episode count (REQ-16).
- **Progress on school and course screens** is the status computed by the 024 rules in force — never a separately stored «percent done» [owner, direction].
- **The Q-7 rule** — any lesson may be started without the previous ones, the certificate is only for the whole course — is available as **a rules preset** a course can take, not as fixed platform behaviour [owner, P0; preset proposed]. Course completion under it requires every module to be done.
- The **«lesson of the day»** in the feed is always a lesson of a course and links to that course [owner, D3].
- **Partner and advertising content** on school and course pages is explicitly labelled (REQ-66); advertising inside a lesson follows the single rule in [024](../024-learning-module-path/024-product.md).
- **Document entry:** the course shows which document it leads to and its prerequisites; document verification can be entered at any time from the course (REQ-17, REQ-22); issuing the document is 038 and the verification record is 037.
- A **guest** reads schools and programs before registering; gated steps show an honest gate, and no gated content is served to a guest.
- **A live event recording (014) is neither a lesson nor a course episode** [owner, D8].
- Prices and purchase are shown and performed through feature **025**; interface copy never says «бесплатно» next to points.
- The screens work at the **mobile breakpoint**, meet the platform accessibility bar, and show the same progress as the mobile application (REQ-53).

## Out of scope

- **What happens inside a module and a lesson** — the path, lesson composition, the rules constructor, tests, presets — feature **024**.
- **Points, prices, purchase of a module or course, the specialty top** — feature **025** (#1794) [owner, D7 for the top].
- **Issuing the document** (certificate, НМО) — feature **038**; document verification storage and statuses — **037**.
- **The authoring/administration screens** for schools and courses — no feature owns them yet (research point 6 on #1792); 023 states the author story the admin surface must satisfy [proposed].
- **The Academy's backstage** — projects and their results (feature 030); the doctor never sees a project.
- **The application flow for mentoring or internship** beyond its entry point — a separate feature when specified [proposed].

## Open questions

From the Issue #1792 «Open / agent-proposed — UNCONFIRMED» list:

- **«Money and points are counted per lesson»** — the 03:45 note came with the cancelled «module is optional» variant; units of purchase are now the course and the module; points are decided in **025 (#1794)**.
- **A single lesson from the 033 application** — course → one module → one lesson conflicts with «six lessons per module». This PRD proposes: six is a preset default, and a single-module course hides its module level [proposed].
- **What «viewed» means per material type, test retakes, whether the entry test counts** — settings of the 024 constructor (see 024).

Further questions raised by this PRD [proposed]:

- **What a finished module gives on its own** — a document of its own, points only, or only progress toward the course certificate.
- **Whether a school can exist without any published course** («скоро»), and whether a doctor can register interest.
- **Where graduate reviews come from** — only doctors who finished a course of the school, or any participant; and who moderates them.
- **Whether the club that closes a module is part of the module's completion rule** by default (it is a live event, not a lesson element).
- **What the doctor sees of a course's rules preset** — its name («Путь», «ДПО») or only its effects.

## Capability owner

No row exists yet in [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md) for schools and courses. **[proposed]** The structure (direction → school → course → module → lesson) belongs to the same shared package as the 024 learning model — working name `packages/learning` — so the school, course, module and lesson are one model with one rules evaluator; the doctor storefront (`apps/doctor`) adds only route files and host-config fields (ADR-0013 §A1), and reuses the 018 doctor content card. The registry row is added when the EARS triplet is authored, not in this PRD.

## Approved mockup

**Pending — `author-design-mockup`.** No Stage-A canvas exists for `#d-school` yet; the school screen and the course program need an owner pick before building.
