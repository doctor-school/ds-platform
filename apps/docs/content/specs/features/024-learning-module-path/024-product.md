---
title: "Feature 024 — The learning module and the series path (PRD)"
description: "Product requirements for how a doctor learns on `doctor.school`: a lesson is a set of elements (series episode, microlearning, downloadable material, podcast, test, clinical case…) worth about one academic hour, never a single video; the path through a module is drawn as a map; and every rule of completion, unlocking, order, visibility and testing is a setting of a rules constructor with inheritance and named presets, not code. Progress is kept as facts and statuses are computed from the current rules. Also the gating, podcast companion, partner downloads, corrective material, star ratings, feedback and mobile parity of the lesson screen. Wave 2, `blocked_by` 017 and 025; source of the 024 EARS triplet (ADR-0014)."
slug: two-site-ia-024-learning-module-path-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
storefronts: doctor-only
storefronts_reason: "The learning module and the series path are doctor-storefront screens (#d-lesson, apps/doctor, functional map §B 024). The Academy serves the expert audience and specifies no lesson or path surface; the learning model it produces (ADR-0016 §4: school, course and module are project results) is shown to doctors only on the doctor storefront."
lang: en
---

> **EN (this)** · **RU:** [`024-product-ru.md`](./024-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 2** (022, 023, 024, 025, 044). 024 is `blocked_by` **017** (the storefront shell and the chosen specialty) and **025** (accrual and spending of attention points is part of a module's behaviour). Feature **023** (school and course) is `blocked_by` 024: the school and course are containers over the modules and lessons defined here. Domain canon: [ADR-0016](../../../adr/0016-core-domain-model-en.md) §4, §6. Discovery record: Issue #1792 (owner decisions P0, D1–D9) and #1793.

**Provenance legend.** **[owner]** — owner-approved: the principle P0 («a constructor, not code»), decisions D1–D9 and the five-point constructor direction the owner confirmed on 2026-11-04 («Да, это уже верное направление»). **[proposed]** — `agent-proposed — UNCONFIRMED`: everything else, including every concrete setting, preset content, default value and interface element below. Where D4, D6 and D9 appear, they are **defaults of presets, never hard rules** [owner, P0].

## Feature summary

A doctor on `doctor.school` learns in **lessons**, and a lesson is **not a video** [owner, D5]: «Урок — это совокупность материалов… на 45 минут или академический час. Одно видео — это не урок.» A lesson is a **set of elements** drawn from an extensible catalog of element types — a series episode, microlearning, a downloadable material, a podcast, a test, a clinical case — composed to about one academic hour (≈ 45 min) [owner, D5, D9]. The methodology research behind the default composition (one series episode, microlearning per decomposition element, a downloadable material, one podcast, mandatory entry and exit tests, a clinical case as the lesson's skeleton) is recorded on Issue #1792; this PRD takes it as the **default lesson template**, not as a fixed shape [proposed].

Lessons always live inside a **module**, and modules inside a **course** [owner, D1, D3; direction]; that a module is mandatory, holds six lessons plus a club and is sold separately is a default of the structure preset [proposed default per D4]. 024 owns what happens inside that structure: **the path** a doctor walks through a module — drawn as a map, as in the mobile prototype — and **the rules** that decide what is open, what counts as done, in what order and with which tests.

The central product decision is that **those rules are settings, not code** [owner, P0]. The owner could not — and should not have to — answer in advance whether the next lesson opens after the test, after the video, or immediately: «Это всё должно быть гибко и настраиваемо… за основу мы можем взять Duolingo». So 024 specifies a **rules constructor** [owner, direction]:

1. **Structure is data**: direction → school → course → module → lesson → element; element types come from an extensible catalog [owner, direction].
2. **Rules are data with inheritance** — platform → school → course → module → lesson → element, the nearest override wins — covering completion, unlocking, order, visibility of locked items and test settings [owner, direction; each concrete setting proposed].
3. **Progress is stored as facts** («watched 73 %», «scored 85 % on attempt 2»); statuses such as «done» and «open» are **computed** from the rules in force, so changing a rule recomputes statuses without a release or a data migration; what happens to progress already earned when a rule changes is itself a setting [owner, direction; policy options proposed].
4. **Presets** are named rule sets applied in one action — «Путь (Duolingo)», «Открытый курс», «ДПО / аккредитация» [owner, direction; contents proposed].
5. **What stays code** is only the catalog of condition types, the catalog of element types and the evaluator. A new kind of condition is code; a new combination or a new threshold is a setting [owner, direction].

Around the path, 024 carries the lesson screen's registry scope (functional map §B 024): the teaser-open / content-after-registration gate (REQ-20), the optional podcast companion of a lesson (REQ-35), partner downloadable materials (REQ-66 labelling, REQ-67), corrective material after a mistake (REQ-68), star ratings of lessons (REQ-92), feedback on marketing materials (REQ-135), and parity with the mobile application in content and on one shared points account (REQ-53, OWD-10). **Accrual and spending of points are feature 025 (#1794)**; 024 only says which learning facts 025 reacts to.

## User stories

- **US-1** — As a **doctor**, I open a lesson and see it as **a set of materials worth about an academic hour** — what is in it, how long each part takes, what I have already done — not as one video.
- **US-2** — As a **doctor**, I see the **path of a module as a map**: which lessons are done, which is next, which are locked and why, so I always know where I am.
- **US-3** — As a **doctor**, I can tell from the lesson itself **what makes it count as done** — in the words of the rules that apply to it — before I start.
- **US-4** — As a **doctor**, I take the lesson's **tests** under the rules set for them — the threshold, the number of attempts, any pause between attempts, and whether an entry test comes first — and I see my result and what remains.
- **US-5** — As a **doctor who already knows the material**, I can **test out** of a part of the path where the rules allow it, and what I skipped counts as done, as «Jump here» does in Duolingo.
- **US-6** — As a **doctor**, after a mistake in a test I am offered the **corrective material** for exactly that mistake, and my mistakes lower my percentage but never take points away.
- **US-7** — As a **doctor**, I can come back to a lesson I finished and **repeat it**, without losing the completion I earned.
- **US-8** — As a **guest**, I can read a lesson's description and teaser before registering, and the screen tells me honestly that the content itself needs an account.
- **US-9** — As a **doctor**, I see the lesson's **podcast companion** when there is one and can listen to it as part of the lesson or alongside it.
- **US-10** — As a **doctor**, I can download a **partner's material**, and it is clearly **labelled as partner content**.
- **US-11** — As a **doctor**, I can **rate a lesson with stars** and leave **feedback on a marketing material**, and I know where that feedback goes.
- **US-12** — As a **doctor on a phone or in the mobile app**, I find the same lessons, the same progress and the same points account — the site and the app are one product.
- **US-13** — As a **school or course author (a role of the Academy)**, I **choose a preset** for a course — «Путь (Duolingo)», «Открытый курс», «ДПО / аккредитация» — and the whole course follows it without anyone writing code.
- **US-14** — As an **author**, I **override a rule at any level** — the school, the course, a module, a lesson or a single element — and the nearest override is the one that applies; I can see which level a rule comes from.
- **US-15** — As an **author**, I compose a **completion rule** from conditions joined by «all of», «any of» or «N of M» — material watched to X %, file opened, test at or above the threshold, club attended, manual mark — and an **unlock rule** — open at once, after the previous item, from a date, by an expression, by purchase, by test-out.
- **US-16** — As an **author**, I set the **order** of a module (strict or free) and the **visibility of what is locked** (hidden or shown with a lock).
- **US-17** — As an **author changing a rule on a live course**, I decide what happens to **progress doctors have already earned** — keep it or require it again — and doctors' statuses follow the new rule without a release.
- **US-18** — As a **product owner**, the **element-type and condition-type catalogs** can grow (a new element such as a clinical case, a new condition such as «podcast listened to the end») as a product change, while every combination and every number stays a setting.
- **US-19** — As a **doctor**, what I did is **never silently lost** when rules change: my facts stay, and if a status changes the screen tells me why.
- **US-20** — As **feature 025**, I receive the doctor's learning facts and computed statuses (element done, lesson done, module done, test passed) as the events I accrue points on — 024 does not decide the points.

## Flows

**A doctor walks a module (US-1, US-2, US-3, US-4):**

1. From a course (feature 023) or the lesson of the day in the feed (018) the doctor opens a module → the path map shows each lesson's computed status (done, open, locked with the reason, «test out available»).
2. The doctor opens an open lesson → the lesson shows its elements with durations, the completion rule in plain words and what is already done.
3. The doctor goes through the elements in the order the rules allow; each element records its facts (watched to N %, opened, listened, answered).
4. The doctor takes the exit test → the result is recorded as a fact on the attempt; under the default «ДПО / аккредитация» preset the lesson is done when all elements are done and the exit test is at or above 80 % [owner, D6 as a default; proposed preset].
5. The lesson's status turns «done» → the path recomputes → the next lesson opens if the unlock rule says so.

**Test-out (US-5):** the doctor chooses «перейти сюда» on a locked part of the path where the rules allow test-out → takes the test-out test → at or above its threshold the skipped items count as done; below it, nothing changes and the doctor is told what to do next. Whether a failed test-out has a cooldown is a test setting [proposed].

**A mistake (US-6):** a wrong answer in a test → the doctor's percentage reflects it → the corrective material linked to that question is offered after the test (REQ-68).

**A guest (US-8):** a guest opens a lesson → description, element list and teaser are visible → each content element shows the registration gate → registration (feature 021) returns the doctor to the same lesson (REQ-20).

**An author applies a preset and overrides (US-13, US-14, US-15):**

1. The author applies «Путь (Duolingo)» to a course → strict order, unlock after the previous lesson, test-out enabled, repeat allowed.
2. The author overrides one module to free order → only that module changes; the rest of the course still inherits the preset.
3. The author sees, for any rule, the level it is inherited from.

**An author changes a rule on a live course (US-17, US-19):** the author raises a lesson's test threshold → chooses «keep earned completions» or «require again» → statuses recompute from the stored facts → a doctor whose status changed sees the reason on the lesson.

## Product acceptance criteria

- **A lesson is a set of elements**, never a single video; each element has a type from the element-type catalog and an expected duration; the default template targets about one academic hour (≈ 45 min) [owner, D5; template proposed]. A lesson is published only as a whole — a lesson whose composition is incomplete is not shown to doctors [proposed, from CP O-169].
- **Every lesson belongs to a module of a course** [owner, D1, D3; direction]; 024 offers no free-standing lesson.
- **Completion, unlocking, order, visibility of locked items and test settings are settings**, editable by an author without a release; none of them is a constant in code [owner, P0].
- **Settings inherit** platform → school → course → module → lesson → element; the **nearest override applies**, and the author can see where each effective rule comes from [owner, direction; display proposed].
- **Completion rules** combine conditions with «all of», «any of» and «N of M» [owner, direction]. The initial condition types are: watched to at least X %, file opened, podcast listened to at least X %, test at or above its threshold, club attended, manual mark [proposed]. What «viewed» means for each element type is defined per type in the catalog, with a configurable percentage where it applies [proposed; Issue #1792 Open list].
- **Unlock rules** cover: open at once, after the previous item is done, from a date, by an expression over other items, by purchase, and by test-out [owner, direction; set proposed]. **Order** is strict or free; **locked items** are hidden or shown with a lock [owner, direction].
- **Test settings** cover the pass threshold, the number of attempts, the pause between attempts, whether an entry test is required and whether it counts toward completion, and the number of questions; mistakes lower the percentage and never remove points [owner, direction; set and the «mistakes» rule proposed, the latter from the PRD v1 rule].
- **Progress is kept as facts**; «done» and «open» are **computed** from the rules in force. Changing a rule recomputes statuses without a data migration and without losing any fact [owner, direction].
- **Earned progress on a rule change** follows a setting chosen at the time of the change — keep earned completions or require them again; a doctor whose status changed sees why [owner, direction; options and display proposed].
- **Named presets** exist and apply in one action [owner, direction]. Their initial contents [proposed]:
  - **«Путь (Duolingo)»** — strict order, unlock after the previous item, test-out allowed, repeat of completed lessons allowed, locked items shown with a lock.
  - **«Открытый курс»** — everything open, free order; a lesson is done when all its elements are viewed and the exit test is passed.
  - **«ДПО / аккредитация»** — a lesson is done when all elements are viewed and the exit test is at or above 80 %; the entry test is required; strict order inside a module. This preset carries the D6 default [owner, D6 as a default].
  - The default lesson composition (a free set of elements with mandatory tests) is the default of every preset, not a rule [owner, D9 as a default].
- **What stays code** is only the element-type catalog, the condition-type catalog and the evaluator; adding a type is a product change through the normal pipeline, adding a combination or a number is not [owner, direction].
- **The path map** shows every lesson's computed status and, for a locked one, the reason in the doctor's words [proposed].
- **Gate (REQ-20):** a guest sees the description, element list and teaser of a lesson; content elements show an honest registration gate; no gated content is served to a guest.
- **Podcast companion (REQ-35)** is an optional element of a lesson; whether it counts toward completion is the lesson's completion rule [proposed].
- **Partner downloads (REQ-67)** are an element type and carry the partner/advertising label (REQ-66).
- **Advertising inside a lesson — the single rule (023 refers here):** partner or advertising content appears in a lesson only as a labelled partner element (REQ-66, REQ-67); there is no advertising inside microlearning or any other instructional element [proposed, from CP O-044].
- **Corrective material (REQ-68)** can be linked to a test question and is offered after a wrong answer.
- **Star ratings (REQ-92)** and **feedback on marketing materials (REQ-135)** are available to a signed-in doctor on the lesson.
- **Mobile parity (REQ-53, OWD-10):** the same lessons, facts and statuses, and one points account, on the site and in the mobile application; the screens work at the mobile breakpoint and meet the platform accessibility bar.
- **Points** are not decided here: 024 exposes learning facts and computed statuses; accrual, prices and spending are feature 025 (#1794).
- **A recording of a live event (014) is not a lesson and not a course episode** [owner, D8].
- Interface copy never says «бесплатно» next to points; the word «проект» never appears in the doctor's interface.

## Out of scope

- **School, course and the course/module catalog and program view** — feature **023**; 024 covers what happens inside a module and its lessons.
- **Accrual, prices, advance credit and spending of points; purchase of a module or course** — feature **025** (#1794); 024 provides the «by purchase» unlock condition and the learning facts.
- **Issuing the document on completion** (certificate, НМО) — feature **038**; verification of documents — **037**.
- **The authoring/administration screens** for schools, courses, lessons, elements and rules — no feature owns them yet (research point 6 on #1792); 024 states the author stories the admin surface must satisfy, not its screens [proposed].
- **Content production routing** (who submits, methodologist, producer) — feature **040**.
- **Gamification layers over the path** (XP, hearts, streaks, leagues) — an application layer, not part of the lesson (CP 2026-04-30); the specialty top is 018 / 025 [owner, D7].
- **The mobile application itself** — a separate track; 024 fixes parity only.
- **Live event recordings** — feature **014**; they are not lessons [owner, D8].

## Open questions

From the Issue #1792 «Open / agent-proposed — UNCONFIRMED» list:

- **«Money and points are counted per lesson»** — this note of 03:45 arrived with the cancelled «module is optional» variant. Units of purchase are now the course and the module; how points are counted is decided in **025 (#1794)**.
- **A single lesson from the 033 application** — course → one module → one lesson conflicts with the «6 lessons per module» norm. This PRD proposes that 6 lessons is a default of presets, not a constraint, and that a single-module course hides its module level (see 023) [proposed].
- **What «viewed» means for each material type; test retakes; whether the entry test counts toward completion** — this PRD makes all three settings (see the acceptance criteria) with per-type defaults still to be chosen [proposed].

Further questions raised by this PRD [proposed]:

- **The default completion threshold per element type** (e.g. video watched to 90 %? file opened once?) — the evaluator needs a default for every type.
- **Which role may change rules on a live course**, and whether a rule change needs a second person's approval.
- **The default policy for earned progress on a rule change** — keep (safer for doctors) or require again (safer for accreditation).
- **Whether test-out is allowed under «ДПО / аккредитация»** — accreditation reporting needs «who watched what and for how long», which test-out skips.
- **The theory share**: 18 lessons × 45 min = 18 academic hours = 50 % of a 36-hour course, against the 40 % theory norm recorded in the methodology research.

## Capability owner

No row exists yet in [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md) for the learning structure, rules or progress. **[proposed]** One shared package — working name `packages/learning` — owns the structure model, the rule model with inheritance and presets, the progress facts and the evaluator, with the doctor storefront (`apps/doctor`) adding only route files and host-config fields (ADR-0013 §A1), and the mobile application consuming the same API. The registry row is added when the EARS triplet is authored, not in this PRD.

## Approved mockup

**Pending — `author-design-mockup`.** No Stage-A canvas exists for `#d-lesson` yet; the path map, the lesson screen and the author's rule editor need an owner pick before building.
