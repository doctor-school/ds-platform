---
title: "Feature 023 — The school and the course (PRD)"
description: "Product requirements for the structure a doctor learns in on `doctor.school`: a direction has several schools, one per expert; a school holds courses; a course is made of modules — module size and the closing club are course-level settings (by default six lessons and a club); a module holds lessons; for the doctor all content is free and nothing is bought. The school screen with its course cards, the course page as the learner's path through the whole course (the path is defined by 024), graduate reviews, mentoring and internship at school level, partner/advertising labelling, the «start anywhere, certificate only for the whole course» rule as a preset of the 024 rules constructor, and the entry into document verification on completion. Wave 2, `blocked_by` 024; source of the 023 EARS triplet (ADR-0014)."
slug: two-site-ia-023-school-and-course-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
storefronts: doctor-only
storefronts_reason: "School and course are doctor-storefront products (#d-school, apps/doctor, functional map §B 023). The Academy has no school surface: there a school or course is a project result behind the scenes (ADR-0016 §4), and the doctor sees only the finished school on the doctor storefront."
lang: en
---

> **EN (this)** · **RU:** [`023-product-ru.md`](./023-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 2** (022, 023, 024, 025, 044). 023 is `blocked_by` **024** — the school and course are containers over the modules and lessons defined in [024](../024-learning-module-path/024-product.md), and building the container before its contents means rebuilding both. Domain canon: [ADR-0016](../../../adr/0016-core-domain-model-en.md) §4 (school, course and module are project results), §5 (a school is tied to a direction). Discovery record: Issue #1792 (owner decisions P0, D1–D10, D18) and #1793 (owner decisions D11–D15 — the course path, its form on the website, the count in lessons, the path node as a step and video completion).

**Provenance legend.** **[owner]** — owner-approved: the principle P0 («a constructor, not code»), decisions D1–D15 (D10, 2026-11-04: doctors buy nothing; D11, 2026-11-11: a course is one continuous learner's path, [decision in #1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6797305382); D12, 2026-11-12: the form of the path on the website is the «snake», as in the application prototype, [decision in #1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6813121925); D13, 2026-11-12: on doctor screens a course is only the path, counted in lessons, [decision in #1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6813354018); D14, 2026-11-12: a path node is a step, a lesson is a run of consecutive steps, [decision in #1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6819762465); D15, 2026-11-12: a video counts as viewed at 100 %, [decision in #1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6819762465)), D18 (2026-11-12: what a finished module gives is a module setting — points, a document or both — and the course certificate stays, [decision in #1792](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6823318348)), the Stage A approval of the school screen (2026-11-12, [record in #1792](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6824581100)) and the five-point constructor direction the owner confirmed on 2026-11-04. **[lead]** — the lead's decisions of 2026-11-12 under AGENTS.md §7 ([#1792](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6823318348), [#1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6822255430)). **[proposed]** — `agent-proposed — UNCONFIRMED`: everything else, including every concrete setting, default value and interface element below. D4, D6 and D9 are **defaults of settings or presets, never hard rules** [owner, P0].

## Feature summary

Doctor.School is a «school of schools». On the doctor storefront the end product a doctor chooses is a **school** — not an Academy project, which a doctor never sees (REQ-50, ADR-0016 §4). 023 defines that product and its structure:

- **Direction → school → course → module → lesson** [owner, D1]. A direction can have **several schools, one per expert**; a course always lives inside a school [owner, D2]. A lesson always lives inside a course and its module; the feed's «lesson of the day» is a lesson of a course with a link to that course [owner, D3].
- **Modules group a course's lessons; every course has at least one module** [owner, D3; direction]. The module size and the closing club are **course-level settings** of the 024 constructor, inherited and overridden as in [024](../024-learning-module-path/024-product.md) (Product acceptance criteria, «Settings inherit»); by default a module is six lessons + a club [owner, D4 as a default]. The reference course (an ДПО block of 36 hours) is three modules × six lessons = 18 lessons + 18 podcasts + 3 clubs — an example, not a norm [proposed, from the methodology research on #1792].
- **For the doctor all content is free; nothing is bought** [owner, D10]. No school, course, module or lesson has a price for the doctor, and no doctor screen offers a purchase. «Sold separately» in the CP is a deal with a sponsor (B2B), not a doctor purchase [owner, D10].
- **A single-module course hides its module level** in the interface, so a short course (including the single lesson from the 033 author application) reads as a course of lessons, not as «module 1 of 1» [lead, 2026-11-12, [#1792](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6823318348)].
- **What a finished module gives is a module setting**: points (025), a document (038), or both; the course certificate is always for the whole course [owner, D18]. By default a module gives points and no module document [lead, D18 default].

The school screen shows a school as a product of its direction: who leads it, which courses it offers and what they lead to, what graduates say (REQ-118), and what the school gives beyond lessons — **mentoring and internships as school-level functions** (REQ-119). The school's courses are shown as a vertical list of cards, and a card leads to the course path; with more than six courses, the courses the doctor is taking stay cards under «Вы учитесь» and the rest become rows with «Найти курс» and «Показать ещё 10»; the document block follows the courses, and a signed-in doctor with unconfirmed documents sees a verification band over the courses [owner, Stage A 2026-11-12, [c.6824581100](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6824581100)]. A school with no published course is shown as **«скоро»** with a specialty interest capture; any expected-date text is a field of the school's data, never fixed copy [lead, 2026-11-12]. **Graduate reviews** come only from doctors who finished a course of that school and are published after staff moderation [lead, 2026-11-12]. **The course page is the learner's path through the whole course**, as [024](../024-learning-module-path/024-product.md) defines it («The course path»): modules are sections of the path, nodes are steps, a lesson is a run of consecutive steps [owner, D14], each module is closed by its club node, the course by its document node; alongside are the duration in academic hours and the document the course leads to. The course page is never a list of collapsible modules with lesson rows [owner, D11, 2026-11-11, [decision in #1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6797305382)]. On doctor screens a course is only the path, counted in lessons; the words «series» and «N episodes» do not appear there [owner, D13].

The rules of how the course is walked — what opens when, what counts as done — are **not defined here**: they are the settings of the 024 rules constructor, inherited from the school and the course. 023 contributes the course-level rule from the registry, Q-7: **«урок №5 без предыдущих можно, сертификат — только за полный курс»** — a doctor may start with any lesson, but the certificate requires the whole course. Under P0 this is **a preset of the constructor** — the 024 preset «Открытый курс» (every item open immediately, free order, course completion = all modules done) —, not a hard-coded behaviour [owner, P0; preset of 024]. The doctor never sees a preset's name, only its effects in words («чтобы пройти урок, нужно…») [lead, 2026-11-12]. The club that closes a module is a live scheduled event and is **not** part of the module's completion rule by default; the author switches it on by a setting [lead, 2026-11-12].

On completion, a course leads to a **document**: 023 shows the doctor what the course leads to and gives the **entry into document verification**, available at any time (REQ-17, REQ-22); issuing the document is feature 038 and verification storage is 037. Partner and advertising content on a school or course page is **explicitly labelled** (REQ-66); what advertising may appear inside a lesson is the single rule stated in [024](../024-learning-module-path/024-product.md) (Product acceptance criteria, partner downloads).

## User stories

- **US-1** — As a **doctor**, I see the **schools of my direction** and understand that each is led by its own expert, so I choose a school as I would choose a teacher.
- **US-2** — As a **doctor**, I open a **school** and see who leads it, which courses it offers, what they lead to and what else the school gives — mentoring, internships.
- **US-3** — As a **doctor**, I open a **course** and see its **path** — one continuous path through the whole course: modules as sections, the lessons in each, the club that closes each module, the document at the end and the total in academic hours.
- **US-4** — retired 2026-11-04: doctors buy nothing (D10).
- **US-5** — As a **doctor**, I can **start a course from any lesson** where the course's rules allow it, and I see clearly that **the certificate needs the whole course**.
- **US-6** — As a **doctor in the middle of a course**, the course and its modules show **my progress** as computed by the rules in force, and the next step is one action away.
- **US-7** — As a **doctor**, I read **graduate reviews** of a school or course before I commit my time.
- **US-8** — As a **doctor**, I see **mentoring and internship** offers of the school and how to apply for them.
- **US-9** — As a **doctor**, any **partner or advertising material** on a school or course page is labelled as such, so I always know what is educational and what is promotional.
- **US-10** — As a **doctor finishing a course**, I see which **document** the course leads to and what I need for it, and I can **submit my documents for verification** at any time — not only at the end.
- **US-11** — As a **doctor taking a short course** of a single module, I see a course of lessons, not a «module 1 of 1» layer.
- **US-12** — As a **doctor arriving from the lesson of the day** in the feed, I land in the lesson **inside its course** and can see where it sits on the course path.
- **US-13** — As a **guest**, I can read a school and a course path before registering; the screens say honestly which step needs an account.
- **US-14** — As a **school or course author (a role of the Academy)**, I set the **structure** of a course — its modules and lessons — and pick its rules **preset** from 024 (for example «start anywhere, certificate for the whole course»), with no code change.
- **US-15** — As a **doctor on a phone**, the school and course path screens work as well as on desktop, and my progress is the same as in the mobile app.

## Flows

**Choosing a school and a course (US-1, US-2, US-3, US-7):**

1. From the specialty feed (018) the doctor opens a school → the school screen: its expert, its course cards with what each leads to, graduate reviews, mentoring and internships.
2. The doctor opens a course card → the course path: modules are sections of the path, nodes are steps, lessons are segments of consecutive steps, a club closes each module, the document node is at the end; alongside, the duration in academic hours; each step's state for this doctor, if they are already learning.
3. The doctor opens a step of the path → the step opens as its own screen, and the path and the lesson (024) take over.

**Starting anywhere, certificate for the whole course (US-5, Q-7):**

1. Under the «start anywhere» preset the doctor opens lesson 5 directly → it is open.
2. The course path shows lessons 1–4 as not yet done, and the document block says the certificate needs every module done.
3. When the course's completion rule is met, the document block leads to issuance (feature 038).

**Verification at any time (US-10):** the doctor opens «Документы» from a course → the verification entry (REQ-22) leads to the document upload of 037 → the course shows the verification status where the document requires it.

**A guest (US-13):** a guest opens a school or course → everything descriptive is readable → starting a lesson shows the registration gate (021) and returns the doctor to the same place.

## Product acceptance criteria

- **The structure is direction → school → course → module → lesson** [owner, D1]; a direction may have several schools, each led by one expert; a course belongs to exactly one school [owner, D2]; a lesson belongs to exactly one module of one course [owner, D3; direction].
- **Every course has at least one module** [owner, D3; direction]. The module size and the closing club are course-level settings of the 024 constructor, inherited and overridden as in [024](../024-learning-module-path/024-product.md) (Product acceptance criteria, «Settings inherit»); by default a module is six lessons + a club [owner, D4 as a default]; they are settings, not constraints [owner, P0].
- **A single-module course hides its module level** in the doctor's interface [lead, 2026-11-12].
- **A finished module gives what its module setting says** — points, a document, or both; by default points and no module document; the course certificate is always for the whole course [owner, D18; default lead].
- **The club closing a module is not in the module's completion by default**; a course setting switches it on [lead, 2026-11-12].
- **A school with no published course** shows «скоро» and a specialty interest capture; its expected-date text is school data [lead, 2026-11-12].
- **Graduate reviews** are written only by doctors who finished a course of that school and appear after staff moderation [lead, 2026-11-12].
- **The doctor never sees a rules preset's name**, only its effects in words [lead, 2026-11-12].
- The **school screen** presents a school as the doctor's end product: its expert, its courses as a vertical list of cards with what they lead to (a card leads to the course path; more than six — «Вы учитесь» cards and the rest as rows with search and «Показать ещё 10») [owner, Stage A 2026-11-12], graduate reviews (REQ-118), mentoring and internships as school-level functions (REQ-119). The word «проект» never appears in the doctor's interface (REQ-50).
- **The course page is the course path** of [024](../024-learning-module-path/024-product.md): one continuous path through the whole course, modules are its sections, nodes are steps, a lesson is a run of consecutive steps [owner, D14], each module is closed by its club node, the course by its document node; alongside, the duration in academic hours and the lesson count. On doctor screens a course is only the path: the words «series» and «N episodes» do not appear there, the count is in lessons (REQ-16 describes the video format, not on-screen text) [owner, D13]. A list of collapsible modules with lesson rows is neither drawn nor built [owner, D11].
- **Progress on school and course screens** is the status computed by the 024 rules in force — never a separately stored «percent done» [owner, direction].
- **The Q-7 rule** — any lesson may be started without the previous ones, the certificate is only for the whole course — is available as **a rules preset** a course can take — the 024 preset «Открытый курс» —, not as fixed platform behaviour [owner, P0]. Course completion under it requires every module to be done.
- The **«lesson of the day»** in the feed is always a lesson of a course and links to that course [owner, D3].
- **Partner and advertising content** on school and course pages is explicitly labelled (REQ-66); advertising inside a lesson follows the single rule in [024](../024-learning-module-path/024-product.md).
- **Document entry:** the course shows which document it leads to and its prerequisites; document verification can be entered at any time from the course (REQ-17, REQ-22); issuing the document is 038 and the verification record is 037.
- A **guest** reads schools and course paths before registering; gated steps show an honest gate, and no gated content is served to a guest.
- **A live event recording (014) is neither a lesson nor a course episode** [owner, D8].
- **No price, purchase or sale** appears anywhere on the doctor's school, course, module or lesson screens: for the doctor all content is free and nothing is bought [owner, D10]. Interface copy makes no statement about money or who pays and never says «бесплатно» in any form [owner, 2026-11-10, #2534].
- The screens work at the **mobile breakpoint**, meet the platform accessibility bar, and show the same progress as the mobile application (REQ-53).

## Out of scope

- **The course path and what happens inside a lesson** — the path model, nodes and their states, lesson composition, the rules constructor, tests, presets — feature **024**; 023 shows that path as the course page.
- **Points and the specialty top** — feature **025** (#1794) [owner, D7 for the top]; points are earned, never bought.
- **Issuing the document** (certificate, НМО) — feature **038**; document verification storage and statuses — **037**.
- **The rules and lesson editor** — feature **024** owns lesson composition, the rules editor and the live-course change dialog. 023 owns the **admin structure editor** — schools, courses, module order, size and club, the module reward (D18) and review moderation — in `apps/admin`, built from `@ds/design-system` per `build-ui-from-design-system`, with no canvas and no Stage A (admin surface) [lead, [#1793](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6822255430)].
- **A list of a direction's schools** beyond the school screen — no approved canvas yet; it needs the owner's Stage A before it is built.
- **The Academy's backstage** — projects and their results (feature 030); the doctor never sees a project.
- **The application flow for mentoring or internship** beyond its entry point — a separate feature when specified [proposed].

## Settled points

- **No money is counted for the doctor**; doctors buy nothing [owner, D10], and how points are counted is **025 (#1794)**.
- **A single lesson from the 033 application** is a course of one module of one lesson: six lessons per module is a default of a setting, and a single-module course hides its module level [lead, 2026-11-12].
- **What «viewed» means per material type, test retakes, whether the entry test counts** — settings of the 024 constructor, decided in 024.
- **A finished module, «скоро», reviews, the club and the preset's name** — as stated in the summary and the acceptance criteria above [owner, D18; lead, 2026-11-12].

## Delivery

Vertical slices (F-22): each slice pairs a doctor or admin screen with its backend. The first slice is the school screen and its course cards leading to the 024 path for a seeded school, reading the 024 model; the structure editor, «скоро» and interest, documents and the module reward, graduate reviews, and mentoring with the school's events follow — slice order in `023-design.md`.

## Capability owner

The [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md) row «Learning path — course page and lesson» names the owner: `packages/learning` (planned, working name). The structure (direction → school → course → module → lesson) belongs to the same shared package as the 024 learning model — working name `packages/learning` — so the school, course, module and lesson are one model with one rules evaluator; the school, course and module rows themselves are created by 024, and 023 adds their descriptive data, the school screen and the structure editor. The doctor storefront (`apps/doctor`) adds only route files and host-config fields (ADR-0013 §A1), and reuses the 018 doctor content card; the row's shape is fixed by the 024 and 023 triplets.

## Approved mockup

The school screen `#d-school` is `design-source/doctor-school.dc.html`: Stage-A approved by the owner on 2026-11-12 («Го»), record [#1792 comment 6824581100](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6824581100) — the school's courses as a vertical list of cards leading to the course path (more than six courses: «Вы учитесь» cards and the rest as rows with search and «Показать ещё»), the document block after the courses, and a verification band over the courses for a signed-in doctor with unconfirmed documents (owner choices, [#1792 comment 6823220434](https://github.com/doctor-school/ds-platform/issues/1792#issuecomment-6823220434)). The course page — the course path, on the website the «snake», as in the application prototype [owner, D12] — is `design-source/doctor-course.dc.html`: Stage-A approved by the owner on v16, 2026-11-11 («теперь лучше»), record [#1793 comment 6821468757](https://github.com/doctor-school/ds-platform/issues/1793#issuecomment-6821468757).
