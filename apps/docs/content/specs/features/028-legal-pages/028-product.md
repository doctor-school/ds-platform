---
title: "Feature 028 — Legal documents & contacts (PRD)"
description: "Product requirements for the legally public surface of both storefronts: a «Документы и контакты» page on doctor.school and on the Academy — documents, contacts and requisites as blocks of one page — serving one shared body of content from one legal entity. Thin slice 1 (R1) publishes the personal-data policy, the exact consent texts feature 021 links from its checkboxes, contacts with the operator's requisites, and the educational-licence block; contracts, the constitution and the teal-model documents follow in slice 2 (R3) with feature 037. Source of the 028 EARS triplet (ADR-0014)."
slug: two-site-ia-028-legal-pages-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`028-product-ru.md`](./028-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 3** (028 + 037 + 038 — «the platform is legally public»). 028 is delivered in **two slices**: **slice 1 (R1)** — personal-data policy, the 021 consent texts, contacts and requisites, the licence block — carries **no `blocked_by`**; **slice 2 (R3)** — contracts, the constitution, the teal-model documents (REQ-74) and payment/refund terms — stays `blocked_by` **037**, because the composition and retention wording of those documents is derived from the accepted personal-data lifecycle. It reuses the **008** portal shell and the **017** doctor-storefront shell rather than introducing a surface of its own; the verification strategy is ADR-0016 §7.

## Feature summary

The platform asks a doctor to tick a consent checkbox before it will let them register (feature 021), and asks an Academy visitor to tick one before it will accept a partnership lead. Both checkboxes point at a document. Today that document does not exist on the platform: the only link in the codebase points at `doctor.school/index/privacy-pay` on the **legacy site** — a route that renders an empty shell. Feature 028 is what those checkboxes will link to.

The owner's framing (2026-09-06) is that this is **not a legal-documents project** but the minimum that makes the platform legally public. Hence a deliberately thin **slice 1** for R1: the **personal-data policy**, the **exact texts of the 021 consents**, **contacts with requisites**, and a **licence block**. Contracts, the constitution and the «teal» documents REQ-74 asks for are real obligations, but they are not what blocks registration — they move to **slice 2 in R3**, alongside 037, whose accepted personal-data lifecycle their wording depends on.

Three product decisions shape the surface.

**One feature, both storefronts, shared content** (owner, 2026-08-22, F-5). `doctor.school` and the Academy each get their own «Документы и контакты» page (`#d-docs` / `#a-docs`, REQ-136) — documents, contacts and requisites are blocks of that one page per the vendored canvases — but the document bodies are authored once and served identically on both hosts. A doctor and a regulator read the same policy; there is no per-host legal fork.

**One legal entity on the documents: ООО «Ивекскон»** (owner, 2026-09-06). The legacy site shows two entities — ООО «Ивекскон» as the personal-data operator, with full requisites, and АНО ДПО «Академия Доктор Скул (Школа)» as the licence holder, with every requisite field left blank. Slice 1 publishes «Ивекскон» as the operator behind the platform's requisites. Which entity is named as the **licensee** — and therefore whose licence number appears in the licence block — is a live owner-and-lawyer question (Q-31, tied to the НМО provider question), and the licence block's content is an **owner-input dependency**, not a technical one.

**No link back to the legacy site** (owner, verbatim: «мы не ведём на старый сайт»). The legacy texts are the **source copy** — the personal-data policy body, the consent wordings and the contacts copy are lifted from there and re-published here — but no surface of the new platform links to `doctor.school/index/*`. The `ACADEMY_PRIVACY_POLICY_URL` constant that today points at the legacy route is repointed at the platform's own policy document.

What is being replaced is not a working surface. The legacy site's legal routes (`/privacy-pay`, `/contacts`, `/pay-info`) are empty page shells; the actual document bodies live only as orphaned, unrouted reusable elements. Nothing there is versioned, dated or reachable. 028 is therefore a **first publication**, not a migration.

## User stories

- **US-1** — As a **guest doctor stopped at a consent checkbox**, the document named next to the checkbox opens as a real page on the site I am already on, so I can read what I am agreeing to before I agree to it.
- **US-2** — As a **doctor**, the consent text I am shown at registration is **the same text** that is published as a document, word for word — not a summary of it.
- **US-3** — As a **doctor**, I can find the platform's documents without having come from a checkbox — there is a visible way in from any page.
- **US-4** — As a **doctor**, each document tells me **from what date the edition I am reading applies** («редакция от …»), so «I agreed to the policy» means something specific.
- **US-5** — As a **doctor**, I can see how the platform handles my personal data — what is collected, on what basis, for how long, and how I ask for it to be changed or withdrawn — in plain language rather than as a legal wall.
- **US-6** — As a **doctor**, I read the same policy whether I opened it from `doctor.school` or from the Academy; the platform does not appear to have two different sets of rules.
- **US-7** — As a **registering doctor**, opening a document does not lose my half-filled registration form.
- **US-8** — As an **Academy visitor leaving a partnership lead**, the privacy consent under that form links to the platform's own policy document, not to an outside site.
- **US-9** — As an **expert, partner or investor evaluating the Academy**, I can see that the organisation behind it is a real one — a named legal entity with requisites (name, ИНН, ОГРН, legal address) and a working support email — before I hand over anything.
- **US-10** — As a **regulator or a checking visitor**, I can establish **who the personal-data operator is**, from the site itself, without a support request.
- **US-11** — As a **checking visitor**, I can see the platform's **educational licence** — its number, the authority that issued it, and a way to confirm it in the official registry.
- **US-12** — As a **visitor with a question**, the contacts block of the documents page gives me a working way to reach a human — the support email and the platform's public channels.
- **US-13** — As a **doctor on a phone**, documents are readable at 390 as well as at 1440 — long legal text does not become an unusable wall on mobile.
- **US-14** — As a **visitor using a screen reader**, a document page is navigable by its headings and structure rather than being one undifferentiated block of text.
- **US-15** — As a **doctor**, every link I follow from a consent or a footer lands on a **document on this platform**; nothing hands me off to the old site.
- **US-16** — As the **platform team**, I can publish a corrected version of a document without breaking the links that consent records and the registration form already point at.
- **US-17** — As the **platform team**, when a doctor asks «what exactly did I agree to», I can point at a stable URL for that document and name the edition that was current then.
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

1. A visitor on either storefront reaches the «Документы и контакты» page from the footer entry point its shell already carries.
2. The page lists every published document with its title and its edition date, and marks a recently re-published one with an «обновлено» chip; each document opens at its own stable URL.
3. The same list, with the same bodies, is reachable on the other storefront under that host's own section.

**Establishing who is behind the platform (US-9, US-10, US-11, US-12):**

1. A regulator, partner or curious visitor opens the «Документы и контакты» page on either storefront and reaches its contacts block.
2. They find the operating legal entity — ООО «Ивекскон» — with its requisites (ИНН, ОГРН, legal address) and the support email; contacts are channels, not a phone desk.
3. The licence row in the documents list, together with the licence number in the requisites line at the foot of the page, presents the educational licence and how to verify it in the official registry. _(Its content is an owner/lawyer input — see Open questions → Q-31.)_

**Publishing a corrected document (US-4, US-16, US-17):**

1. The platform team corrects a document's text.
2. It is published as a **new edition with a new «редакция от» date**, and its row carries the «обновлено» chip; the document's URL does not change, so consent copy, footers and stored consent references keep working.
3. A reader always sees which edition is current; what a doctor consented to earlier remains identifiable. _(How the superseded text stays retrievable is 037's consent-record concern, not this surface's.)_

**Branches:**

- **A document has no approved content yet** (the licence block before the owner supplies it) — the surface does not publish an empty or placeholder legal page; the entry is absent until there is real content. A dev placeholder standing in for a legal text is never acceptable.
- **A visitor opens a document URL directly**, with no site context — the page is complete on its own: title, edition date, body, and a way back to the «Документы и контакты» page.

## Product acceptance criteria

### Slice 1 (R1) — what this feature ships now

- Each storefront — `doctor.school` (`apps/doctor`) and the Academy (`apps/portal`) — has **its own «Документы и контакты» page** (owner-settled, F-5 / REQ-136; canvases `#d-docs` / `#a-docs`) carrying the documents list, the contacts block and the requisites line, rendered in that host's existing shell (017 / 008), while the **document bodies are one shared set of content** rather than two per-host copies.
- The R1 list on **both** hosts holds exactly two published entries — **Лицензия на образовательную деятельность** and **Политика персональных данных и согласия** — plus whatever rows the 021 consent texts are split into (fork 2 of prompt 21). «Пользовательское соглашение» and «Правила начисления очков», drawn on the canvases, are slice 2 (owner, 2026-09-06) and appear in neither list nor footer in R1.
- Every document is reachable at a **stable per-document URL** that does not change when its text is corrected; consent checkboxes and the Academy lead form link a **specific document**, never the index. The index page and its row unit are canvas-settled; the per-document URL itself is a lead proposal — **not drawn on any canvas — settled by the document-page Stage A**.
- The **personal-data policy** is published, sourced from the legacy text (152-ФЗ policy) and naming **ООО «Ивекскон»** as the operator.
- The **exact texts of the 021 consents** are published as documents — the medical-worker declaration, the partner-data-sharing consent and the marketing-communications consent — and the wording a doctor sees at registration matches the published document word for word.
- The **photo/video distribution consent** text (present in the legacy material) is published as a document on this surface. Whether any R1 surface links it is an open question; publication does not itself create a link.
- **Contacts and requisites** are published as blocks of that page on both storefronts. The **requisites line** carries the legally required minimum for a Russian operating entity — full name, ИНН, **ОГРН**, legal address, plus the licence number. ОГРН is a CONTENT addition over the canvas placeholder line («ООО «Доктор Скул» · ИНН 0000000000 · Лицензия … № … · Казань, ул. Примерная, 1», obviously placeholder data), required by the seller-disclosure minimum (ФЗ «О защите прав потребителей» ст. 9 / ФЗ-149 ст. 10) — **not a layout change**: the same single faint tabular line, the same element. **Contacts are channels only — no phone and no support form** (canvas-settled): `support@doctor.school` / `academy@doctor.school` as mailto plus the Telegram / ВКонтакте / YouTube chips, which carry no per-channel captions; the only captions drawn beside them are the support line «Мы отвечаем в рабочие дни.» (doctor canvas) and «Эфиры, фрагменты подкастов, новости проектов.» under the same chip row (Academy canvas).
- The **licence block** is the «Лицензия на образовательную деятельность» row in the documents list plus the licence number in the requisites line (canvas-settled), presenting the licence — number, issuing authority, a way to verify it in the official registry, and the scan. Its content is an **owner/lawyer input** (Q-31); until it is supplied the row is absent, never a placeholder.
- Every document page states its **title and edition date** («редакция от <дата>»); nothing is published undated. A re-published document carries the «обновлено» chip in the index; no numeric version number is shown to the reader (canvas `d-docs · документы`).
- **No surface of the platform links to the legacy site.** The `ACADEMY_PRIVACY_POLICY_URL` used by the Academy partnership lead form points at the platform's own policy document, and no document, footer or consent line references `doctor.school/index/*`.
- Documents are **readable at 390 and 1440**, in light and dark, using design-system primitives and typography — a legal text is a reading surface, not a bespoke layout.
- Document pages meet the platform's accessibility bar for a public page (the `playwright-axe` gate): real heading structure, meaningful document order, links that name their destination.
- Publishing a corrected version **does not break** existing links from consent copy, the registration form or stored consent references.
- A document with no approved content is **not published at all** — no empty page, no «coming soon», no placeholder text on a legal surface.

### Slice 2 (R3) — the same surface, extended

- **Contracts and public documents**, the **constitution** and the **teal-model documents** REQ-74 names are published in the same section, with the same versioning and the same two-host projection.
- **Payment and refund terms** are published once paid flows exist; the legacy `pay-info` text is a source, but its 2023 price table is stale data and is not carried over.
- Document composition and retention wording follow the **accepted personal-data lifecycle** delivered by **037** — which is why slice 2, and only slice 2, is `blocked_by` 037.
- **«Пользовательское соглашение»** is published in slice 2 (owner, 2026-09-06). Both canvases draw it as a ready row and the doctor footer links it, but the legacy export carries no terms/public-offer text at all: R1 shows neither the row nor the footer link («hide the block until content»), and the text is an owner/lawyer input for R3.
- **«Правила начисления очков»** is published in slice 2 (owner, 2026-09-06) — 028 only publishes it; the rules themselves are written by feature **025** and delivered there. No R1 row on either host.
- Adding these documents requires **no second legal surface**: they are entries in the section slice 1 already built.

## Approved-mockup reference

**Stage-A baseline: the owner-drawn canvases, vendored 2026-08-24 (#1450).** Two artboard sets carry this surface:

- [`design-source/doctor-docs.dc.html`](../../../../../../design-source/doctor-docs.dc.html) — screen `#d-docs`, the doctor storefront (`apps/doctor`), in the 017 shell.
- [`design-source/academy-docs.dc.html`](../../../../../../design-source/academy-docs.dc.html) — screen `#a-docs`, the Academy (`apps/portal`), in the 008 shell.

**Forks.**

| Fork                                       | Prop               | Options                                                                                                                    | Decision                                                                                                                                                                      |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Развилка 1 · состав документов             | `docsVariant`      | А — общий список · Б — проекция витрины · В — с группировкой                                                               | **Б «проекция витрины»** — the canvas default, i.e. the decision: each host lists its own projection of one shared legal set (F-5).                                           |
| Composition of the R3 contracts            | `contractsVariant` | А — открытые формы · Б — по запросу · В — эксперту открыто, инвестору по запросу (Academy canvas, «Развилка 3 · договоры») | Canvas default «А — открытые формы» is the recorded baseline (Б/В draw a «Запросить форму» / «✓ запрос отправлен» state); the call itself is slice 2 (R3), not decided in R1. |
| Развилка 1 промпта 21 · оглавление на 1440 | `tocVariant`       | А — колонка слева · Б — колонка справа · В — сверху, без прилипания                                                        | **А «колонка слева»** — the canvas default, i.e. the decision: a sticky left column at 1440, the collapsed list above the text at 390.                                        |

**Canvas-settled decisions.**

- **One page per host, «Документы и контакты».** H1 «Документы и контакты»; sections by `data-screen-label` — doctor `d-docs · постер-шапка`, `· документы`, `· согласия`, `· контакты`, `· реквизиты`, `· футер`; Academy `a-docs · постер-шапка`, `· документы`, `· контакты`, `· выходы`, `· реквизиты`, `· футер`. Contacts and requisites are blocks of that page, not a separate contacts page.
- **Fork 1 projection.** `docsVariant: Б` means each host lists its own projection of ONE shared legal set (F-5): the doctor artboard draws Лицензия на образовательную деятельность · Политика персональных данных и согласия · Пользовательское соглашение · Правила начисления очков (drawn in the «готовится» state), the Academy artboard Лицензия на образовательную деятельность · Политика персональных данных и согласия · Договоры · Конституция Doctor.School («готовится») · Пользовательское соглашение. **In R1 both lists hold only two entries** — Лицензия and Политика персональных данных и согласия (plus whatever rows fork 2 of prompt 21 splits the 021 consent texts into); every other drawn row is slice 2.
- **Document-link row unit** (`d-docs · документы`): title + optional «обновлено» chip + note + «редакция от <дата>» + →. The reader-visible version marker IS the edition date plus that chip; no numeric version number is drawn.
- **Consents explainer** (`d-docs · согласия`, «Про согласия»): consents are separate by purpose — partner data, public display, mailing — and what was given and when is visible in the cabinet, which the block links. Explanation only; consents are not managed on this page.
- **Contacts are channels, no form** (`d-docs · контакты` / `a-docs · контакты`): `support@doctor.school` / `academy@doctor.school` as mailto, plus Telegram / ВКонтакте / YouTube chips. The doctor page carries a «клиникам и организациям → Academy.Doctor.School ↗» exit; `a-docs · выходы` carries the two CJM exits (Инвесторам → `#a-invest`, Экспертам → `#a-apply`).
- **The doctor documents list ends with an exit to the Academy documents page.** In the decided variant Б the doctor canvas closes the list (`d-docs · документы`) with the caption «Полный набор документов платформы — на странице документов Академии.»: the doctor host lists only its own projection, and the full shared legal set is read on the Academy page. The Academy canvas draws no counterpart. This is the second doctor→Academy exit on this page, alongside the contacts «клиникам и организациям → Academy.Doctor.School ↑» item — REQ-24 fixes the two allowed doctor→Academy placements as the storefront footer link and «Стать экспертом» in the cabinet, and prompt 19 §«Не рисовать» says `#d-docs` adds no Academy link of its own — so this caption is a **canvas-vs-REQ-24 conflict**, recorded as an owner open question below; the PRD asserts neither that the cap is met nor that the caption is dropped.
- **Requisites are one faint tabular line** at the foot of the page (`· реквизиты`): «<юрлицо> · ИНН … · Лицензия на образовательную деятельность № …». The canvas placeholder names another entity; the CONTENT is the owner decision recorded above (ООО «Ивекскон»), the LAYOUT is the canvas decision.
- **The licence block is a documents-list row**, not a separate panel — plus the licence number in the requisites line. Canvas note (doctor): «На её основании Doctor.School выдаёт сертификаты и передаёт сведения в НМО»; canvas comment on the Academy screen: `Q-31: лицензиат и эмитент — сама платформа, без оговорок`. The Q-31 wording stays an owner/lawyer input; the layout is settled.
- **Both shells carry a footer entry point.** `d-docs · футер` links «Пользовательское соглашение», «Политика обработки персональных данных» and «Контакты»; `a-docs · футер` carries the «Документы и контакты» nav link and «doctor.school — врачам». In R1 the footer links only what R1 publishes — the «Пользовательское соглашение» link appears with its document, in slice 2.
- **The pending row state «готовится»** is drawn on **both** hosts (Правила начисления очков on the doctor canvas, Конституция Doctor.School on the Academy canvas) but is NOT used in slice 1: the owner rule «hide the block until content» (2026-08-27) keeps a slice-1 document with no approved text absent altogether. The «готовится» row is reserved for documents the owner explicitly announces (slice 2, R3).

**The document reading page — the owner's pick (2026-09-06, verbatim «A»).** The owner picked option А — ONE artboard «Документ» for both storefronts, drawn by the owner in Claude Design from the prompt [`21-document-ru.md`](../../product/two-site-ia/design-prompts-ru/21-document-ru.md) (this is the «Б — страница документа внутри витрины» answer to fork 2 of prompts 19/20); the document rows on `#d-docs` / `#a-docs` still point at `href="#"`, the route itself is slice-1 work. The canvas is drawn and vendored 2026-09-06: [`design-source/document.dc.html`](../../../../../../design-source/document.dc.html) — screens `#d-document` / `#a-document`, ONE unit for BOTH shells (prop `shell` `витрина врача|Академия`, each shell inlined, no imported unit). Drawn states: guest and logged-in (`loggedIn`), long policy with a table of contents and short consent text (`doc` `длинный — политика|короткий — текст согласия`), the «обновлено» chip (`updated`), `dataState` `обычно|загрузка|ошибка|не найден`, the 390 collapsed table of contents and the dark theme. Fork 1 — the table-of-contents placement — is settled by the canvas default and recorded in the Forks table above; the other two prompt-21 forks (the 021 consent-text split and the licence-scan form) are NOT drawn by this canvas and stay open questions below. The rendered result is still re-confirmed on the live stand before merge (AGENTS.md §6 — design-approval gate).

## Out of scope

- **Legacy-site redirects.** The old routes are not redirected, mirrored or linked; the legacy texts are source copy only.
- **Consent recording mechanics.** Which consents are asked, how they are presented at registration and how each record is written is feature **021**; the record store, retention and withdrawal handling is **037**. 028 owns only the published document those records refer to.
- **Document verification** — the doctor's diplomas, certificates and their verification queue are **037**.
- **NMO records and codes** — feature **038**.
- **Payment flows.** No paid flow exists in R1, so payment and refund terms are not part of slice 1.
- **A self-service consent-withdrawal toggle** — 021 fixes withdrawal as a manager-handled request; this surface publishes the text, it does not operate the lifecycle.
- **An admin authoring UI for documents.** How the platform team edits document text (repo-managed content vs CMS) is a design-level mechanism question, not a product decision of this PRD.
- **Legal drafting itself.** The platform publishes what the owner and the lawyer approve; 028 does not author legal language.
- **Corporate «about us» marketing content** — the contacts and requisites blocks carry identity and requisites, not a company story.

## Open questions

Everything below is either an **owner call** or an owner/lawyer input; the phrase **not drawn on any canvas** marks the items the vendored `#d-docs` / `#a-docs` artboards do not answer. Decisions the canvases DO settle are recorded in «Approved-mockup reference», not here.

- **The variant-Б caption on `#d-docs` vs REQ-24 — a canvas-vs-rule conflict (owner call).** The doctor canvas closes the documents list with «Полный набор документов платформы — на странице документов Академии.», a doctor→Academy exit REQ-24 does not allow (its two placements are the footer link and «Стать экспертом» in the cabinet; prompt 19 §«Не рисовать» says `#d-docs` adds no Academy link). Either the owner redraws the artboard without the caption (full canvas cycle, then re-vendor) or REQ-24 is amended to name this caption as a third placement. Until decided, the caption is neither built nor dropped.
- **Q-31 (owner + lawyer, open): who is the licensee / НМО provider.** Two entities exist in the legacy material — ООО «Ивекскон» (personal-data operator, full requisites) and АНО ДПО «Академия Доктор Скул (Школа)» (licence entity, requisites blank). The operating entity on the documents is decided (Ивекскон); **which entity is named as licensee on the published block is not**. Accepted **ADR-0016 §7** already records the partial answer — Doctor.School holds the educational licence and is the issuer of record — so the open part is narrower: the entity naming. This is an **owner-input dependency** of slice 1, deliberately not modelled as a `blocked_by` edge.
- **The document reading page — drawn and vendored 2026-09-06 (`design-source/document.dc.html`).** The owner picked option А (2026-09-06) and drew the artboard «Документ» from prompt [`21-document-ru.md`](../../product/two-site-ia/design-prompts-ru/21-document-ru.md); the page's composition — title, edition date, table of contents, body, back link — is settled by that canvas and recorded in «Approved-mockup reference», together with fork 1 (`tocVariant` А). What the canvas does not draw stays open in the bullets below.
- **Whether each 021 consent is its own document row and URL — not drawn on any canvas.** The canvas index draws ONE row, «Политика персональных данных и согласия». Sections of that one document versus separate rows with their own URLs is fork 2 of prompt 21 — the «Документ» canvas does not draw it either (its short doc is titled «Согласие на передачу данных партнёрам платформы», while its «Другие документы» list still shows the single row «Политика персональных данных и согласия»).
- **The photo/video consent's placement — not drawn on any canvas.** 028 hosts the text as content; neither host's canvas draws a row or a link for it, and it is settled with the same document-composition fork in prompt 21.
- **The consent-checkbox link targets — not drawn on any canvas.** The `auth.dc.html` canvas draws no document links, so which document each 021 checkbox opens is settled together with the document page (prompt 21).
- **The per-document stable URL** — a lead proposal, **not drawn on any canvas**; settled by the document-page Stage A, because it depends on that page existing.
- **One authoring, two hosts — the mechanism.** That content is authored once and projected on both storefronts is settled; whether the text is repo-managed or CMS-managed is a design-level question, **not drawn on any canvas**.
- **The versioning mechanism.** The reader-visible marker is settled (edition date + «обновлено» chip); whether superseded editions stay publicly readable, and where the historical text a doctor consented to lives (here or in 037's consent record), is unresolved and **not drawn on any canvas**.
- **Whether the licence scan is a file, an image or a registry deep link**, and whether a scan is published at all before the licensee question is settled — **not drawn on any canvas**: it is fork 3 of prompt 21, and the «Документ» canvas does not draw it either — its document footer is the requisites line only, with no licence number, issuer, «проверить в реестре» link or scan block.
- **Payment/refund terms excluded from slice 1** on the grounds that R1 has no paid flows — a lead scope call, **not drawn on any canvas**.

## Prior art — source system

The legacy Bubble application (`dctrschl.bubble`) is a **text source, not a UI reference** — its legal surface is defunct.

Four legal-adjacent routes exist by name — `/contacts`, `/privacy-pay`, `/pay-info`, `/contact-info` — and **all four are empty page shells**, carrying only a shared 1×1 tracking element. The real document bodies survive as **orphaned reusable elements never placed on any page**: a complete 152-ФЗ personal-data policy in nine sections (including a refund section), a payment-terms page that embeds a stale 2023 price table, and a contacts block. Two personal-data consent strings exist as literal content on form surfaces — a short checkbox label and a longer photo/media-distribution consent.

Three absences matter. There is **no public offer** anywhere in the export, **no licence text and no licence route**, and **nothing is versioned** — the policy declares itself evergreen «until replaced by a new version», with no version marker to replace it against. Two entities appear: **ООО «Ивекскон»** with full requisites (ИНН 5032225006, ОГРН 1155032013806, Москва, ул. Енисейская д.2 с.2, офис 703; info@doctor.school; +7 (495) 410-04-90) as the personal-data operator, and **АНО ДПО «Академия Доктор Скул (Школа)»** as the licence entity with every requisite value field left blank.

On the live platform the situation is thinner still: **no legal page exists** in `apps/doctor` or `apps/portal`. The single policy reference in the codebase is the `ACADEMY_PRIVACY_POLICY_URL` constant used by the Academy partnership lead form, pointing at the legacy `/index/privacy-pay` route — i.e. at an empty shell. 028 is therefore the platform's **first** legal publication, designed fresh; the legacy text is copied as content, never reproduced as structure.
