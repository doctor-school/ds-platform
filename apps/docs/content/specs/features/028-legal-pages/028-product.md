---
title: "Feature 028 — Legal documents & contacts (PRD)"
description: "Product requirements for the legally public surface of both storefronts: a documents section and a contacts page on doctor.school and on the Academy, serving one shared body of content from one legal entity. Thin slice A (R1) publishes the personal-data policy, the exact consent texts feature 021 links from its checkboxes, contacts with the operator's requisites, and the educational-licence block; contracts, the constitution and the teal-model documents follow in slice 2 (R3) with feature 037. Source of the 028 EARS triplet (ADR-0014)."
slug: two-site-ia-028-legal-pages-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`028-product-ru.md`](./028-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 3** (028 + 037 + 038 — «the platform is legally public»). 028 is delivered in **two slices**: **slice A (R1)** — personal-data policy, the 021 consent texts, contacts and requisites, the licence block — carries **no `blocked_by`**; **slice 2 (R3)** — contracts, the constitution, the teal-model documents (REQ-74) and payment/refund terms — stays `blocked_by` **037**, because the composition and retention wording of those documents is derived from the accepted personal-data lifecycle. It reuses the **008** portal shell and the **017** doctor-storefront shell rather than introducing a surface of its own; the verification strategy is ADR-0016 §7.

## Feature summary

The platform asks a doctor to tick a consent checkbox before it will let them register (feature 021), and asks an Academy visitor to tick one before it will accept a partnership lead. Both checkboxes point at a document. Today that document does not exist on the platform: the only link in the codebase points at `doctor.school/index/privacy-pay` on the **legacy site** — a route that renders an empty shell. Feature 028 is what those checkboxes will link to.

The owner's framing (2026-09-06) is that this is **not a legal-documents project** but the minimum that makes the platform legally public. Hence a deliberately thin **slice A** for R1: the **personal-data policy**, the **exact texts of the 021 consents**, **contacts with requisites**, and a **licence block**. Contracts, the constitution and the «teal» documents REQ-74 asks for are real obligations, but they are not what blocks registration — they move to **slice 2 in R3**, alongside 037, whose accepted personal-data lifecycle their wording depends on.

Three product decisions shape the surface.

**One feature, both storefronts, shared content** (owner, 2026-08-22, F-5). `doctor.school` and the Academy each get their own documents section and their own contacts page (`#d-docs` / `#a-docs`, REQ-136), but the document bodies are authored once and served identically on both hosts. A doctor and a regulator read the same policy; there is no per-host legal fork.

**One legal entity on the documents: ООО «Ивекскон»** (owner, 2026-09-06). The legacy site shows two entities — ООО «Ивекскон» as the personal-data operator, with full requisites, and АНО ДПО «Академия Доктор Скул (Школа)» as the licence holder, with every requisite field left blank. Slice A publishes «Ивекскон» as the operator behind the platform's requisites. Which entity is named as the **licensee** — and therefore whose licence number appears in the licence block — is a live owner-and-lawyer question (Q-31, tied to the НМО provider question), and the licence block's content is an **owner-input dependency**, not a technical one.

**No link back to the legacy site** (owner, verbatim: «мы не ведём на старый сайт»). The legacy texts are the **source copy** — the personal-data policy body, the consent wordings and the contacts copy are lifted from there and re-published here — but no surface of the new platform links to `doctor.school/index/*`. The `ACADEMY_PRIVACY_POLICY_URL` constant that today points at the legacy route is repointed at the platform's own policy document.

What is being replaced is not a working surface. The legacy site's legal routes (`/privacy-pay`, `/contacts`, `/pay-info`) are empty page shells; the actual document bodies live only as orphaned, unrouted reusable elements. Nothing there is versioned, dated or reachable. 028 is therefore a **first publication**, not a migration.

## User stories

- **US-1** — As a **guest doctor stopped at a consent checkbox**, the document named next to the checkbox opens as a real page on the site I am already on, so I can read what I am agreeing to before I agree to it.
- **US-2** — As a **doctor**, the consent text I am shown at registration is **the same text** that is published as a document, word for word — not a summary of it.
- **US-3** — As a **doctor**, I can find the platform's documents without having come from a checkbox — there is a visible way in from any page.
- **US-4** — As a **doctor**, each document tells me **which version I am reading and from what date it applies**, so «I agreed to the policy» means something specific.
- **US-5** — As a **doctor**, I can see how the platform handles my personal data — what is collected, on what basis, for how long, and how I ask for it to be changed or withdrawn — in plain language rather than as a legal wall.
- **US-6** — As a **doctor**, I read the same policy whether I opened it from `doctor.school` or from the Academy; the platform does not appear to have two different sets of rules.
- **US-7** — As a **registering doctor**, opening a document does not lose my half-filled registration form.
- **US-8** — As an **Academy visitor leaving a partnership lead**, the privacy consent under that form links to the platform's own policy document, not to an outside site.
- **US-9** — As an **expert, partner or investor evaluating the Academy**, I can see that the organisation behind it is a real one — a named legal entity with requisites, an address, a phone number and an email — before I hand over anything.
- **US-10** — As a **regulator or a checking visitor**, I can establish **who the personal-data operator is**, from the site itself, without a support request.
- **US-11** — As a **checking visitor**, I can see the platform's **educational licence** — its number, the authority that issued it, and a way to confirm it in the official registry.
- **US-12** — As a **visitor with a question**, the contacts page gives me a working way to reach a human — support email, phone, and what each channel is for.
- **US-13** — As a **doctor on a phone**, documents are readable at 390 as well as at 1440 — long legal text does not become an unusable wall on mobile.
- **US-14** — As a **visitor using a screen reader**, a document page is navigable by its headings and structure rather than being one undifferentiated block of text.
- **US-15** — As a **doctor**, every link I follow from a consent or a footer lands on a **document on this platform**; nothing hands me off to the old site.
- **US-16** — As the **platform team**, I can publish a corrected version of a document without breaking the links that consent records and the registration form already point at.
- **US-17** — As the **platform team**, when a doctor asks «what exactly did I agree to», I can point at a stable URL for that document and that version.
- **US-18** — As the **platform team**, adding the R3 documents (contracts, constitution, teal-model documents, payment terms) means adding entries to a section that already exists, not building a second legal surface.

## Flows

**Reading a document from a consent checkbox (US-1, US-2, US-7, US-15):**

1. A guest doctor reaches the registration form on `doctor.school` (021) and sees the medical-worker declaration, the partner-data consent and the marketing opt-in.
2. Each consent line names its document and links to it — to **that specific document**, never to the documents index.
3. The doctor opens it, reads the same text the checkbox refers to, and returns; the form retains what was already typed.
4. The doctor ticks the box and continues. The consent record 021 writes (and 037 later owns) refers to the document and the version that was published at that moment.

**Reading a document from the Academy lead form (US-8):**

1. An expert, partner or investor fills the Academy partnership form (`apps/portal`) and reaches its personal-data consent line.
2. The link under it opens the platform's **own** personal-data policy document; the stored consent record's policy reference names that document rather than a legacy URL.

**Finding the documents without a checkbox (US-3, US-6):**

1. A visitor on either storefront reaches the documents section from a persistent entry point in the shell.
2. The section lists every published document with its title and effective date; each opens at its own stable URL.
3. The same list, with the same bodies, is reachable on the other storefront under that host's own section.

**Establishing who is behind the platform (US-9, US-10, US-11, US-12):**

1. A regulator, partner or curious visitor opens the contacts page on either storefront.
2. They find the operating legal entity — ООО «Ивекскон» — with its requisites (ИНН, ОГРН, legal address), support email and phone, and what each contact channel is for.
3. The licence block presents the educational licence and how to verify it in the official registry. _(Its content is an owner/lawyer input — see Open questions → Q-31.)_

**Publishing a corrected document (US-4, US-16, US-17):**

1. The platform team corrects a document's text.
2. It is published as a **new version with a new effective date**; the document's URL does not change, so consent copy, footers and stored consent references keep working.
3. A reader always sees which version is current; what a doctor consented to earlier remains identifiable. _(How the superseded text stays retrievable is 037's consent-record concern, not this surface's.)_

**Branches:**

- **A document has no approved content yet** (the licence block before the owner supplies it) — the surface does not publish an empty or placeholder legal page; the entry is absent until there is real content. A dev placeholder standing in for a legal text is never acceptable.
- **A visitor opens a document URL directly**, with no site context — the page is complete on its own: title, date, version, body, and a way back to the section.

## Product acceptance criteria

### Slice A (R1) — what this feature ships now

- Each storefront — `doctor.school` (`apps/doctor`) and the Academy (`apps/portal`) — has **its own documents section and its own contacts page**, rendered in that host's existing shell (017 / 008), while the **document bodies are one shared set of content** rather than two per-host copies.
- Every document is reachable at a **stable per-document URL** that does not change when its text is corrected. Consent checkboxes and the Academy lead form link a **specific document**, never the index.
- The **personal-data policy** is published, sourced from the legacy text (152-ФЗ policy) and naming **ООО «Ивекскон»** as the operator.
- The **exact texts of the 021 consents** are published as documents — the medical-worker declaration, the partner-data-sharing consent and the marketing-communications consent — and the wording a doctor sees at registration matches the published document word for word.
- The **photo/video distribution consent** text (present in the legacy material) is published as a document on this surface. Whether any R1 surface links it is an open question; publication does not itself create a link.
- **Contacts and requisites** are published on both storefronts: the operating entity, ИНН, ОГРН, legal address, support email and phone, and what each channel is for.
- A **licence block** presents the educational licence — number, issuing authority, a way to verify it in the official registry, and the scan — as one identifiable element of the surface. Its content is an **owner/lawyer input** (Q-31); until it is supplied the block is absent, never a placeholder.
- Every document page states its **title, effective date and version**; nothing is published undated.
- **No surface of the platform links to the legacy site.** The `ACADEMY_PRIVACY_POLICY_URL` used by the Academy partnership lead form points at the platform's own policy document, and no document, footer or consent line references `doctor.school/index/*`.
- Documents are **readable at 390 and 1440**, in light and dark, using design-system primitives and typography — a legal text is a reading surface, not a bespoke layout.
- Document pages meet the platform's accessibility bar for a public page (the `playwright-axe` gate): real heading structure, meaningful document order, links that name their destination.
- Publishing a corrected version **does not break** existing links from consent copy, the registration form or stored consent references.
- A document with no approved content is **not published at all** — no empty page, no «coming soon», no placeholder text on a legal surface.

### Slice 2 (R3) — the same surface, extended

- **Contracts and public documents**, the **constitution** and the **teal-model documents** REQ-74 names are published in the same section, with the same versioning and the same two-host projection.
- **Payment and refund terms** are published once paid flows exist; the legacy `pay-info` text is a source, but its 2023 price table is stale data and is not carried over.
- Document composition and retention wording follow the **accepted personal-data lifecycle** delivered by **037** — which is why slice 2, and only slice 2, is `blocked_by` 037.
- Adding these documents requires **no second legal surface**: they are entries in the section slice A already built.

## Approved-mockup reference

**Pending Stage A.** This is a `user-facing` surface, so its look and behaviour are an owner decision: `author-design-mockup` fills this slot with the approved canvas reference and the fork table before implementation, and the rendered result is re-confirmed on the live stand before merge (AGENTS.md §6 — design-approval gate). Nothing in this PRD's prose is a layout decision.

## Out of scope

- **Legacy-site redirects.** The old routes are not redirected, mirrored or linked; the legacy texts are source copy only.
- **Consent recording mechanics.** Which consents are asked, how they are presented at registration and how each record is written is feature **021**; the record store, retention and withdrawal handling is **037**. 028 owns only the published document those records refer to.
- **Document verification** — the doctor's diplomas, certificates and their verification queue are **037**.
- **NMO records and codes** — feature **038**.
- **Payment flows.** No paid flow exists in R1, so payment and refund terms are not part of slice A.
- **A self-service consent-withdrawal toggle** — 021 fixes withdrawal as a manager-handled request; this surface publishes the text, it does not operate the lifecycle.
- **An admin authoring UI for documents.** How the platform team edits document text (repo-managed content vs CMS) is a design-level mechanism question, not a product decision of this PRD.
- **Legal drafting itself.** The platform publishes what the owner and the lawyer approve; 028 does not author legal language.
- **Corporate «about us» marketing content** — the contacts page carries identity and requisites, not a company story.

## Open questions

Items marked **agent-proposed** are this PRD's own proposals and are **unconfirmed by the owner**; they are UX mechanics offered by best practice, not owner forks, and Stage A is where they are settled.

- **Q-31 (owner + lawyer, open): who is the licensee / НМО provider.** Two entities exist in the legacy material — ООО «Ивекскон» (personal-data operator, full requisites) and АНО ДПО «Академия Доктор Скул (Школа)» (licence entity, requisites blank). The operating entity on the documents is decided (Ивекскон); **whose educational licence the licence block shows is not**. This is an **owner-input dependency** of slice A, deliberately not modelled as a `blocked_by` edge.
- **Agent-proposed — the IA.** An index page «Документы» on each storefront listing every document, plus one stable URL per document, with consent checkboxes and the lead form linking a specific document and never the index; a «Контакты» page carrying requisites on each storefront. Unconfirmed.
- **Agent-proposed — per-document title, effective date and version on the page.** The 021 consent records are versioned; nothing on the legacy site is (its policy is explicitly evergreen, «действует бессрочно до замены новой версией»). Whether the reader is shown a version marker at all, and in what form, is unconfirmed.
- **Agent-proposed — entry points.** A footer link in both shells, alongside the consent-checkbox links. **The footer as an element is itself agent-proposed** — whether either shell gets one, and what else it holds, is an owner/Stage-A call.
- **Agent-proposed — one authoring, two hosts.** Content authored once and served on both storefronts. The **mechanism** (repo-managed text vs CMS-managed content) is a design-level open question, not a product decision.
- **Agent-proposed — the photo/video consent's placement.** The text is hosted by 028 as a document; whether any R1 surface links it is open.
- **Agent-proposed — payment/refund terms excluded from slice A** on the grounds that R1 has no paid flows. Unconfirmed as a scope call.
- **The versioning mechanism.** «Version and effective date» is a product outcome; whether superseded versions stay publicly readable, and where the historical text a doctor consented to lives (here, or in 037's consent record), is unresolved.
- **Whether the licence scan is a file, an image or a registry deep link**, and whether a scan is published at all before the licensee question is settled.
- **Whether the contacts page carries a form** or only channels. The legacy contacts copy describes a «Служба технической поддержки портала»; whether the new surface reproduces a support form or lists channels is open.

## Prior art — source system

The legacy Bubble application (`dctrschl.bubble`) is a **text source, not a UI reference** — its legal surface is defunct.

Four legal-adjacent routes exist by name — `/contacts`, `/privacy-pay`, `/pay-info`, `/contact-info` — and **all four are empty page shells**, carrying only a shared 1×1 tracking element. The real document bodies survive as **orphaned reusable elements never placed on any page**: a complete 152-ФЗ personal-data policy in nine sections (including a refund section), a payment-terms page that embeds a stale 2023 price table, and a contacts block. Two personal-data consent strings exist as literal content on form surfaces — a short checkbox label and a longer photo/media-distribution consent.

Three absences matter. There is **no public offer** anywhere in the export, **no licence text and no licence route**, and **nothing is versioned** — the policy declares itself evergreen «until replaced by a new version», with no version marker to replace it against. Two entities appear: **ООО «Ивекскон»** with full requisites (ИНН 5032225006, ОГРН 1155032013806, Москва, ул. Енисейская д.2 с.2, офис 703; info@doctor.school; +7 (495) 410-04-90) as the personal-data operator, and **АНО ДПО «Академия Доктор Скул (Школа)»** as the licence entity with every requisite value field left blank.

On the live platform the situation is thinner still: **no legal page exists** in `apps/doctor` or `apps/portal`. The single policy reference in the codebase is the `ACADEMY_PRIVACY_POLICY_URL` constant used by the Academy partnership lead form, pointing at the legacy `/index/privacy-pay` route — i.e. at an empty shell. 028 is therefore the platform's **first** legal publication, designed fresh; the legacy text is copied as content, never reproduced as structure.
