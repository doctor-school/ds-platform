---
title: "operate-claude-design"
description: "Procedural skill (inline): the single home of the Claude Design rules — where durable context lives, the canon rules for canvases, the reuse-unit registry, copy rules, the English prompt template, prompt provenance and the after-drawing steps. Read it before writing any Claude Design prompt, canvas request, canvas review or vendoring."
name: operate-claude-design
mode: inline
---

# operate-claude-design

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline (the lead writes the prompt, hands it to the owner and posts it on the drawing Issue; the owner draws in Claude Design).

## When to read

Read this skill in full **before** any of: writing a Claude Design prompt; asking the owner for a new or changed canvas; reviewing a canvas against a spec or the code; vendoring a canvas into `design-source/`. It is the only place these rules live — `design-source/README.md`, [`design-approval.md`](../build-ui-from-design-system/design-approval.md) and [`author-design-mockup`](../author-design-mockup/SKILL.md) point here. Never start from an old prompt: none is stored in the repository (see **Provenance**), and copying one inherits its defects.

## Where context lives

Three layers, each carrying only what the layer above does not:

| Layer                                                                                    | Holds                                                                                                                                                                                                                                                      | Maintained by                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Design system** «Doctor.School Design System» (`1366789c-9a05-4137-952e-61147c7a9550`) | The components and tokens of `@ds/design-system` — primitives, blocks, fields — as a bundle the drawing agent builds with and checks a drawing against. It is a published copy: the package in the repository stays the single source of truth (ADR-0013). | The lead publishes it from `@ds/design-system` with `/design-sync`; the durable set (pinned project id, re-sync recipe, bundle conventions) lives in `.design-sync/` and the recipe in `.design-sync/NOTES.md`. |
| **Project** «Doctor.School визуальный язык» (`8cc2f39a-d58e-4491-b539-4337881ced4f`)     | Every canvas: `ds-foundation` shows the visual language, the `unit-*` canvases carry the reuse units, and screen canvases dc-import those units (`ds-shell`, the screens). A canvas the prompt names is already there — the drawing agent opens it.        | The owner draws; the lead vendors the canvases into the repository (see **After the drawing**).                                                                                                                 |
| **Prompt**                                                                               | Only the delta for this one drawing: goal, audience, which canvas to edit, reuse units with what differs, content, switches.                                                                                                                               | The lead, from the template below.                                                                                                                                                                              |

A prompt that restates tokens, component anatomy or constraints the design system and the project canvases already carry bloats the drawing agent's context and drifts from the source of truth (owner correction 2026-07-13, #770): components and tokens come from «Doctor.School Design System», reuse units from the `unit-*` canvases. A prompt may name a design-system component by its export name (`EventSignupCard`, `Button`) instead of describing it. A good prompt states goal, layout, content and audience and names the components and canvases to reuse ([get started](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)).

**Keep the design system current.** A merged change to `packages/design-system` that a canvas would draw (a new or changed component, block, field or token) ⇒ the lead re-syncs the bundle per `.design-sync/NOTES.md` before the next drawing that uses it. A drawing never runs against a bundle older than the component it shows.

### Workspace state

- Design systems tab: «Doctor.School Design System» is the design system every drawing uses. The as-is «DS Platform» seed there is stale — never attach it to a drawing or cite it as canon.
- Projects tab: «Doctor.School визуальный язык» exists and holds the canvases (`ds-foundation`, `unit-*`, screens).

The copy rules below travel in the prompt only where the drawing touches them — never as a pasted rule block.

## Canvas inventory first

Before claiming that a surface needs a **new** canvas or block, and before any Stage-A question to the owner, inventory what is already drawn: DesignSync `list_files` on the project **and** `grep -niE "<route>|<toolbar label>|<state key>" design-source/*.dc.html` (search by toolbar labels and `isVerify`-style state keys, not only by canvas title). A "new block" claim or a Stage-A ask is licensed only when that inventory comes back empty (#779: the header and the discovery front door were already in the canvas). An affordance absent from every canvas is a question for the owner, not a fact to invent.

## Canon rules

One capability, one canvas — the same rule the code follows (ADR-0013 §A1: a capability both storefronts render lives in one feature package; hosts contribute a route file and a host-config object).

1. **One canvas per capability, host as a prop.** A capability both storefronts render has one `.dc.html`; host differences are props / fork panels, never a second `doctor-*` / `academy-*` file. `event-page.dc.html` (`header` prop), `document.dc.html` (`shell` prop) and `auth.dc.html` (`host` prop) are the model. Host-only screens (`doctor-feed`, `doctor-school`, `academy-invest`, …) keep their host prefix.
2. **Tokens only in `ds-foundation.dc.html`.** No other canvas redefines a colour, radius or type step; a canvas that does is a vendoring defect, not a design decision.
3. **Superseded and decision canvases move to `design-source/archive/`** in the PR that vendors the successor or records the decision. The `design-source/README.md` «Files» tables list canon only.
4. **Vendoring writes the registry row.** The PR that vendors a canvas names in `apps/docs/content/specs/product/two-site-ia/capability-ownership.md` the **feature package** (not the host) that will build it; the registry row and the canvas tables stay in sync.
5. **The owner draws once.** When a doctor screen equals an Academy screen, the request is «add the host prop to `<canon>.dc.html`» — never «draw the doctor version». The same applies in the other direction: `auth.dc.html` (#2080) received the `host` prop and the doctor-only blocks; the doctor re-cut went to `archive/`.

Canvas naming (title = vendored file name, group prefixes `ds-*` / no prefix + `host` / `unit-*` / `doctor-*` / `academy-*` / `archive-*`) and the pending consolidation sets: [`design-source/README.md`](../../../../../design-source/README.md) → «Naming convention», «Pending consolidation».

## Reuse units

Change in one place, apply everywhere. If a drawing shows one of these things, it shows **that** unit from the named canvas, inserted as is. The prompt never re-describes its anatomy and never asks for "something similar": it names the canvas file and states **only what differs** (facet set, content, state). "Rebuild", "inspired by", "similar to" for an existing unit are banned words. **A canvas never creates a new primitive.** `@ds/design-system` is the source of truth for components: a primitive a screen needs is built in the design system first, as its own task, and only then appears on a canvas (ADR-0013, ADR-0014 §4). Build screens from existing elements; a new value or element is a deliberate exception named in words in the prompt and in the drawing agent's reply.

| Unit                            | Canvas file                                                                         | How it is used                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Shell (header, footer, theme)   | `ds-shell.dc.html`                                                                  | As is, prop `host`; the screen wraps its content in it and draws no header/footer of its own.                                           |
| Visual language and tokens      | `ds-foundation.dc.html`                                                             | The only source of colour, type, spacing, radii, shadows and grid; no value is invented.                                                |
| Event card                      | `unit-event-card.dc.html`                                                           | As is, both storefronts; «идёт сейчас / запланировано / вы записаны / прошедшее» are states of the unit, not new cards.                 |
| Events feed by day              | `events-feed.dc.html`                                                               | As is, prop `host`; the screen sets only content and filters, never the rhythm or geometry of the feed.                                 |
| Month / week calendar           | `events-feed.dc.html` (`view` `месяц`)                                              | The `view` switch of the one feed page; the compact month in the left column is the same calendar, not a second one.                    |
| Facet panel                     | `unit-events-filter.dc.html`                                                        | Panel geometry as is; only the **set** of facets differs per host.                                                                      |
| Event page                      | `event-page.dc.html`                                                                | One for both storefronts; differs by storefront header and by the `format` switch (online / offline / hybrid).                          |
| Past event and recording        | `event-page-recording.dc.html`                                                      | As is: recording, editing states, guest sign-in gate.                                                                                   |
| Live room and chat              | `unit-room-frame.dc.html` + `unit-chat-column.dc.html` (composed by `room.dc.html`) | One for both storefronts, never redrawn.                                                                                                |
| Sign-in / registration          | `auth.dc.html`                                                                      | As is, prop `host`; differs only by return point and the content of the split's right half.                                             |
| Profile and «Мои события»       | `account-profile.dc.html`, `account-my-events.dc.html`                              | As is; the doctor storefront reuses them as the base of its account.                                                                    |
| Expert card / project card      | `unit-expert-card.dc.html`, `unit-project-card.dc.html`                             | As is, no edits.                                                                                                                        |
| Doctor content card             | `unit-content-card.dc.html`                                                         | School, module and collections reuse it; never reinvented.                                                                              |
| Points badge (Pul · Bre · Con)  | `doctor-lesson.dc.html`                                                             | Three values with a caption and an entry to the accrual history; repeated in the signed-in header and on the module.                    |
| Offline participant ticket / QR | `event-page.dc.html`                                                                | The same ticket in «Мои события»; states «действителен / использован / отменён».                                                        |
| Verification status row         | `doctor-cabinet.dc.html`                                                            | Repeated as a hint wherever verification is required (certificate, НМО).                                                                |
| Organisation leaderboard row    | `academy-partners.dc.html`                                                          | The partner page and the investor cabinet take it as is; only the row content differs.                                                  |
| Document link row               | `doctor-docs.dc.html`                                                               | Title, one-line note, revision date, «обновлено» / «готовится» marks; the Academy documents index and the community page take it as is. |

A new unit has one owner canvas — the one where it is the main subject and its anatomy is complete; any other canvas imports it. Two definitions of one unit cannot exist.

## Copy rules

- **UI strings stay Russian, verbatim.** Every label, heading and placeholder the prompt quotes is product text in Russian, in «guillemets», exactly as it should render. Everything else in the prompt is English.
- **Brand words:** «Doctor.School» is the platform brand as a whole; «витрина врача» is the site `doctor.school`; «Академия» is the site `academy.doctor.school`. «Doctor.School» alone never means the doctor storefront.
- **Who pays is never written in the interface.** The model "doctors learn for free because pharma and medical-device companies fund the education" is designer background only. No heading, kicker, placeholder or diagram caption states it in any form. The interface says only «бесплатно для врача»; partner material carries the legally required mark «Партнёрский материал · Партнёр» (leave room for it in the layout). Where a screen must explain the model, it describes roles and the path (the expert produces, the investor takes part in a project, the doctor learns), never a money flow.
- **Advertising marking.** Partner and educational-advertising material carries a visible mark («Партнёрский материал · Партнёр А», «реклама»). It is a legal requirement, not decoration; every layout that can show such material leaves room for it.
- **Forbidden words:** «спонсор», «рекламодатель», «вкладчик», «создатель», «вложения», and any wording about who pays («оплачивают партнёры», «за счёт партнёров», «платят партнёры», «покупают внимание врачей», «оплачивает проекты», «платят за показы», «спонсируется»). «Верификация» means only confirming a doctor's status by documents; content quality review is «медицинская экспертиза».
- **Role words:** «автор», «соавтор», «инвестор» (the same party is «партнёр» in partnership contexts), «первоинвестор» (a smart-contract role — the party who invested in a specific unit), «участник» (a BBM participant entitled to payouts — a doctor taking courses is a doctor, never «участник»).
- **Pul is not money** (owner 2026-10-01). Never pair Pul with «бесплатно» or any price wording; write «N Pul» only where the amount is required.
- **Register:** calm, medical-educational, «вы». No exclamation marks, no «успей» / «только сегодня» / «эксклюзив» / «прокачай», no emoji in headings or buttons. Promises are concrete and checkable; numbers are realistic in magnitude.

## Prompt template

Write the prompt in **English**, in exactly these sections and this order. Fill every section; delete nothing.

One canvas renders **one page** (owner 2026-10-05, #2562). The page is responsive to the preview width — the desktop layout from 1024 px up, the mobile layout below — and every variation is a toolbar switch in the Claude Design UI, never a separate drawing: the canon canvases already work this way (`host`, `dark`, `state`, `signedIn`, `screen` props). A `width` switch, where a canvas has one, only forces the preview width («авто | десктоп | мобильный»); it never adds fixed frames. Artboard grids and frame matrices (breakpoint × theme × state) are not drawn.

```text
Goal
<Edit | Create> <canon>.dc.html — <one sentence: what the page must add or change>.
One responsive page: desktop layout from 1024 px up, mobile layout below; every variation is a toolbar switch.

Audience
<who uses this screen, in one or two sentences; what they came to do>.

Reuse as-is
- <unit> → <canvas file> → <what differs on this screen, or "nothing">
- …

Content and host differences
<blocks top to bottom with the Russian UI strings quoted verbatim, e.g. heading «Мои заявки на Конгресс»;
then what changes per host value>.

Switches
- host: <values, default first, or "single host: <host>">
- signedIn: <guest | signed-in, default first>
- dark: <off | on>
- state: <обычное | загрузка | пусто | ошибка | …>
- <screen-specific switch, e.g. tense / view / timezone / field state>: <values, default first>
- <open fork, if any>: <option A | option B>

Interactions
<affordances that work on the page itself: sheets, tabs, links between views, hover / focus>.
```

Rules the template encodes:

- **One page, responsive.** The drawing agent builds one page that reflows with the preview width; no fixed 1440 / 390 frames, no side-by-side copies.
- **Every variation is a switch.** Host, signed-in, theme (`dark`), data `state` and screen-specific variations (tense, view, timezone, form-field state…) are toolbar switches, default value first. The state checklist lives as switch values: at least empty, loading, error and guest vs signed-in where the screen has them, and form fields «пусто / заполнено / ошибка / отправлено».
- **Interactions work on the page.** Hover and focus, sheets, tabs and links between views are live on the page, not drawn as frozen copies.
- **Open forks are switches.** A fork the owner has not decided is a switch whose values are the options («option A | B»); a decided fork has no switch — name the decision and its date. Open questions the drawing agent has go into its chat reply, never onto the canvas.

**Do not put into a prompt:**

- paste or preamble meta lines («insert after the project preamble», "read the rules above") — there is no preamble;
- tokens, colours, spacing values or component anatomy — they come from «Doctor.School Design System» and the project canvases (`ds-foundation`, `unit-*`; see «Where context lives»); a prompt names a component by its export name and never restates it;
- Russian prose outside quoted UI copy;
- options for a decision the owner has already made — name the decision and its date instead;
- the anatomy of a reuse unit — name its canvas file and the delta;
- breakpoint or theme matrices, artboard naming or frame grids — one responsive page with switches replaces them.

## Provenance

The prompt is handed to the owner in chat **and** posted as a comment on the drawing Issue. It is never committed as a repository file — the canvas is the artifact; a prompt has no consumer after the drawing exists. Specs and READMEs cite the vendored canvas, never a prompt.

Owner-facing framing: say who does what in which app («я подготовил промпт; рисуете вы в Claude Design»), never a bare tool verb.

## After the drawing

- **Vendor:** pull the exact bytes with DesignSync `get_file`, then `pnpm design:vendor <file>… [--remote <path>]` in a design-source-only PR; recipe, drift check and convergence duty: [`design-source/README.md`](../../../../../design-source/README.md) → «Provenance & how to refresh»; canvas-source rules: [`canvas-source.md`](../build-ui-from-design-system/canvas-source.md). Canon rules 3–4 apply in the same PR.
- **Canvas = decision.** The canvas default is the decision; the owner's redraw date is the approval date. A conflict between canvas and spec is resolved by a redraw and re-vendor, never by code divergence.
- **Parity is driven, not screenshotted:** a real Playwright run drives the UI against the vendored canvas — [`parity-evidence.md`](../build-ui-from-design-system/parity-evidence.md).

## Related skills

- [../build-ui-from-design-system/SKILL.md](../build-ui-from-design-system/SKILL.md) — the delivery-side gate (Stage A/B, canvas source, parity).
- [../author-design-mockup/SKILL.md](../author-design-mockup/SKILL.md) — the discovery-time screen-composition procedure that uses this skill for every Claude Design step.
