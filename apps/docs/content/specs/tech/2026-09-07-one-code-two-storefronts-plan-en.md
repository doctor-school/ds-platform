---
title: One code for two storefronts — feature packages, cleanup and design canon
status: Proposed — owner decision on the marked forks pending; stages 0–1 executable now
date: 2026-09-07
kind: engineering-task plan (retro-driven)
issue: 2020
---

# One code for two storefronts — feature packages, cleanup and design canon

Epic: [#2020](https://github.com/doctor-school/ds-platform/issues/2020). Supersedes the operational reading of ADR-0013 §A1 in `specs/product/two-site-ia/capability-ownership.md` once stage 1 lands. This document is the single place the plan lives between sessions; a session working on it reads this file first and updates the checklists here, never a parallel note.

## 1. Retro finding (why this exists)

Corpus: Claude Code transcripts 2026-09-01…09-07. Twelve distinct owner escalations on one theme — behaviour already live and verified on the Academy storefront (`apps/portal`) re-implemented on the doctor storefront (`apps/doctor`): the events feed (09-01, 09-03), the registration form (09-06), the login page (09-06), the held-password replay after email confirmation (09-07, PR #1946 → #1996), the `/verify` decision rule (09-07, PR #2010), `returnTo=/account` (#1987). Owner, 2026-09-07: «мы дисциплинами это оборачивали, в инструкции писали, в память сохраняли. Что ещё нужно сделать?»

Every previous fix was a **detective control** — a memory file, a skill line, the `cross-front-reuse` WARN PR-body guard, registry rows, a Mode (a) BLOCKER rule (#2002). None changed where the code lives. The structural cause:

- ADR-0013 §A1 names «state machines, action/entry policy» as shared, but its operational form (the registry) drew the boundary at **design-system blocks**. Registry row «Auth flows» says the host projection supplies «copy, resolvers, transport, the guard» — i.e. the whole mechanic. By the letter of the rule every doctor page is a legitimate rewrite.
- Measured as of `origin/main` 90a8ffbd (2026-09-07, excluding `*.test.*`): `apps/portal/lib` 3078 lines, `apps/doctor/lib` 2611 lines; `apps/doctor/components/registration-screen.tsx` 804 lines vs the Academy `register/page.tsx` 216; six twin files (`auth-client`, `auth-error-message`, `bot-protection`, `theme`, `theme-toggle`, `auth-shell`) all diverged (diff lines ≥ file length).
- Spec 021 re-specified a shipped flow as 16 EARS Issues with a boundary table saying «second rendition of the same contract»; implementers built from EARS prose, and deferrals between Issues lost behaviour (PR #1946's body deferred the post-confirmation landing to #1546, which never mentioned sign-in).
- The `cross-front-reuse` guard is satisfied by naming a card; it never compares behaviour.

The repo already contains the correct shape twice: `@ds/room` (`packages/room`; each host mounts `RoomShell` from a thin route — `page.tsx` + `room-client.tsx`, about 200 lines per host holding only the session forward, route table and copy) and `packages/legal-content` + the shared legal-document block (028). The target is «every cross-front capability looks like `@ds/room`».

## 2. Decision — feature packages (the architecture)

**Decision.** A capability used by both storefronts lives in one **feature package** under `packages/` that exports the complete behaviour: page-level components, hooks, URL-state codecs, routing after actions (`returnTo`, replay, entry policy), error dictionaries, default copy and the tests that came with the Academy implementation. A storefront contributes exactly two things per capability: a **route file** (the Next.js `page.tsx` that mounts the package component) and a **host-config object**. Nothing else about that capability may exist under `apps/<host>/`.

**Host config (the only legitimate divergence).** Route table (paths on this host), copy source (a messages object; the Academy passes `next-intl` messages, the doctor host its RU literals until unified), data endpoint / adapter (`/v1/public/events` vs `/v1/storefront/doctor/events` with specialty targeting), filter defaults, brand assets, consent list, feature flags the product owner has decided per host. A divergence that is not expressible as config needs an ADR-backed product reason recorded before implementation (ADR-0013 §A1 unchanged).

**Layering after the change.**

| Layer                                                                                                                                                                     | Owner       | Holds                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api` + `packages/schemas`                                                                                                                                           | one backend | domain, contracts, server policies (CTA, room entry, rate limits)                                                                                       |
| `packages/design-system`                                                                                                                                                  | shared      | primitives and blocks — presentation only, no transport, no routing                                                                                     |
| **feature packages** (`packages/auth-flow`, `packages/events-storefront`, `packages/account`, existing `packages/room`, `packages/legal-content`; names settled per wave) | shared      | pages, hooks, URL state, post-action routing, error maps, default copy, tests                                                                           |
| `apps/portal`, `apps/doctor`                                                                                                                                              | per host    | route files, chrome (header/footer/theme mount), host-config objects, host-only pages (doctor: specialties, hero; Academy: projects, experts, partners) |

**Rejected: multi-tenant single app** (one Next.js app, host-based middleware, Vercel Platforms pattern). It yields the same sharing plus a shared shell, but couples the two tracks into one deploy unit and one release train, while the tracks ship on separate milestones with different IA, and `apps/doctor` already runs as its own container (#1860). Feature packages deliver the sharing without the deployment coupling; the option can be revisited if the shells converge.

**Rejected: «copy the file».** A copy is a fork the same day — the six twin files above are the evidence. The correct form of «copy» in a monorepo is an import. The one bounded exception is stage 0 below: a marked (`// mirror-of:`), DEBT-tracked, branch-by-branch copy that the named wave deletes — never an unmarked copy and never past the R1 release.

## 3. Rules that change (stage 1, docs only)

1. **ADR-0013 §A1** — inline rewrite of «thin host projection»: a route file plus a host-config object. A helper under `apps/<host>/{lib,components}` whose sibling exists on the other host is a violation, not «app-local». The same rewrite moves §A1's closing sentence — ownership of the auth shell and the login / recovery / confirmation **compositions** — from `@ds/design-system` blocks to `packages/auth-flow`; design-system keeps the cards (presentation), the package owns the compositions (behaviour).
2. **Registry `capability-ownership.md`** — new column «Target package / wave»; new section «Host-file allowlist» listing every file permitted under `apps/{portal,doctor}/{lib,components}` with its reason; delete the wording «the two host compositions stay app-local» (row 35) and «extract on a third host or a behavioural divergence» (row 44) — they license duplication; rows 45–46 (`theme-toggle` copy, msk «extract on the next touch») get a target package and wave instead of a DEBT pointer.
3. **Guard** — #2002 is rewritten: replace the PR-body string check with a tree check — a new or changed file under `apps/{portal,doctor}/{lib,components}` that is not in the allowlist fails CI (BLOCK after wave 1; WARN until then). The `cross-front-reuse` PR-body marker is retired when the allowlist guard turns BLOCK. Fold #1874 / #1907 (guard scope for `apps/doctor` and shared packages) into the same work.
4. **Specs** — a storefront spec for a capability already live on the other host is one boundary line «projection of `packages/<x>`; host-config diff: …», never a re-specified EARS list. 021 stays as the recorded counter-example. `author-ears-spec` and `open-ears-issues` 2b get this rule; an EARS Issue whose behaviour the other host already ships is closed as a duplicate of the extraction wave, not implemented.
5. **Briefs** — an extraction brief names both halves (storage/helper AND every call-site decision rule) with `file:line`, lists every behaviour branch (missing / success / failure) the package must reproduce, and forbids a host-local substitute («if the rule does not fit the host, STOP and return the question»). `request-mode-a-review` asks «does the host mount the package, and is every divergence a config field?».
6. **Design canvases** — section 6 below.

## 4. Execution plan

### Stage 0 — freeze during Витрина R1 (now → R1 release)

- No new host-local logic on either storefront. An R1 Issue that already carries `extract-from:` (#1996, #2005) extracts into the package — those are wave-1 bricks landing early.
- An R1 Issue where extraction is too risky at 90 % readiness (#1989 `/reset`, #1768, #1769) copies the Academy rule **branch by branch** with a `// mirror-of: apps/portal/<file>#L<a>-L<b>` marker on every copied unit and one DEBT.md line naming the Issue. The token is exactly `// mirror-of: ` (lower-case, this spelling only); `grep -rn 'mirror-of: ' apps/doctor` (case-sensitive) is the wave input, so a paraphrased marker cannot slip past the wave; a `mirror-of` block without a matching Academy unit is a review BLOCKER.
- `Reuse:` on #1768, #1769, #1989 is completed before their brief is written (section 7).

### Stage 1 — policy (docs only, parallel to R1, no code touched)

- [x] ADR-0013 §A1 rewrite (rule 1).
- [x] Registry: column + allowlist + wording removal (rule 2).
- [x] #2002 re-scoped to the allowlist guard (rule 3); #1874, #1907 linked (#1564 folded in with them).
- [x] `author-ears-spec`, `open-ears-issues` 2b, orchestration brief template, `request-mode-a-review` (rules 4–5).
- [x] `request-mode-a-review`: the stage-0 orphan-marker check — a `// mirror-of:` block whose Academy anchor does not exist or whose branches differ is a `[BLOCKER]`.
- [x] `design-source/README.md` canvas canon (rule 6).
- [x] Milestone «Платформа — один код на два фронта» (track:platform), blocking Витрина R4 (018) and the R1.1 Issues listed in section 7.

### Stage 2 — extraction waves (after the R1 release)

Every wave has the same four steps: (a) move the Academy code and its tests into the package, the Academy consumes it, zero behaviour change, Academy e2e green; (b) the doctor host consumes it, its copy is deleted, Stage-B on both hosts; (c) registry row + allowlist updated in the same PR; (d) `mirror-of` markers for that capability are gone.

| Wave | Package (working name)                       | Moves from `apps/portal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Deletes from `apps/doctor`                                                                                                                                                                                                                                                                          | Closes / absorbs                                                                                          |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1    | `auth-flow`                                  | `app/{login,register,verify,reset}/page.tsx`, `lib/{auth-client,auth-error-message,bot-protection,identifier-validation,registration-handoff,registration-resume,return-to-origin,header-auth,consent,use-redirect-if-authenticated}.ts`, `components/{auth-shell,header-user-cluster}.tsx`, `lib/theme.ts` + `components/{theme-toggle,theme-watcher}.tsx` (the held-password slot is already shared at `packages/design-system/src/blocks/pending-registration.ts`; the brand shell frames `app-shell-header.tsx` / `storefront-header.tsx` stay host-only and mount the package cluster) | `app/(auth)/**`, `components/{login-screen,registration-screen,auth-shell,return-context-card,theme-toggle}.tsx`, `lib/{auth-client,storefront-auth-client,auth-error-message,bot-protection,register-fields,registration-landing,registration-success,return-context,session,shell-auth,theme}.ts` | #1996, #1987, #2001, #1989 remnants, #1548–#1550 (dup), DEBT 2026-09-03 returnTo wrappers + theme-toggle  |
| 2    | `events-storefront`                          | `components/{discovery-listing,event-list-router,calendar-shell,month-calendar-view,month-calendar-mobile,view-switcher}.tsx`, `lib/{public-events,my-events,month-grid,event-lifecycle,msk,recording-signal,recording-cta,participation-cta}.ts`, `app/webinars/page.tsx`, `app/account/events/page.tsx`                                                                                                                                                                                                                                                                                   | `app/(storefront)/events/page.tsx` composition, `lib/{events-feed,events-feed-cards,events-live,events-month,events-month-grid}.ts`, `events/month-pane.tsx`                                                                                                                                        | #1516, #1520, #1524, #1525, #1526, #1485, #1972, #1973, #1652; R4 #1499, #1507 become config; DEBT msk ×4 |
| 3    | `event-page` (or inside `events-storefront`) | `app/webinars/[slug]/{page,register-one-tap}.tsx`, `lib/{registration-client,registration-state,event-playback}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `app/(storefront)/events/[slug]/page.tsx` composition, `lib/event-page.ts`                                                                                                                                                                                                                          | #2005, #1768, #1769, #1767, #1771–#1776 (once, for both hosts)                                            |
| 4    | `account` + `room` leftovers                 | `app/account/page.tsx` transport, `lib/{profile-client,display-name*,room-return}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `components/account-screen.tsx`, `lib/{academy,room}.ts` copies                                                                                                                                                                                                                                     | #1972 tail; DEBT 2026-09-05 room RU strings ×2, `ForwardedSession` ×3, `live-stand-env` ×2                |

Order rationale: wave 1 carries the most escalations and is prod-critical; wave 2 must precede Витрина R4 (018 would otherwise be the fourth feed composition); wave 3 lets feature 020's remaining EARS land once instead of on the doctor composition only.

### Stage 3 — cleanup of what already contradicts the approach

**Docs.**

- [x] `capability-ownership.md` app-local licences (month calendar, returnTo, storefront shell, msk) — rewritten in stage 1, together with the Kind definition and the host-file allowlist.
- [ ] `019-design.md` §1.1 pointer text and `020-*` «for both storefronts» wording — reconcile with the wave-3 package; 020 EARS Issues re-labelled `track:platform`.
- [ ] `021-requirements-{en,ru}.md` boundary table — replace «second rendition of the same contract» rows with «projection of `packages/auth-flow`; host-config diff: consents list, return context».
- [ ] `017-design.md` / `019-design.md` sections describing doctor-local compositions of the feed / calendar / nearest-events block — point at the package.
- [ ] Skills: `open-ears-issues` 2b, `request-mode-a-review`, `report-task-outcome` «reused / extract / new» rule — align vocabulary with «package / host-config / host-only».
- [ ] Memory pointers (Claude auto-memory) collapse into one pointer to this spec.
- [ ] DEBT.md: lines 2026-09-02 (msk ×3), 2026-09-03 (returnTo wrappers, theme-toggle, msk fourth home), 2026-09-05 (room strings, `ForwardedSession`), 2026-09-06 (`live-stand-env`, `escapeLike` ×6, `@custom-variant dark`) — each closed by its wave, not by a separate chore.

**Code.**

- [ ] Twin files retired by wave 1: `auth-client`, `auth-error-message`, `bot-protection`, `theme`, `theme-toggle`, `auth-shell`.
- [ ] `escapeLike` ×6 in `apps/api` — one helper (#1644), independent of the waves.
- [ ] `apps/doctor/e2e/support/live-stand-env.ts` twin — one helper under `packages/` or `tools/`.
- [ ] After wave 4: `apps/doctor/lib` and `apps/portal/lib` contain only allowlisted files; `grep mirror-of` empty.

**Design canvases** — section 6.

### Stage 4 — backlog reconciliation — section 7.

## 5. Guard shape (why an allowlist, not a marker)

A PR-body marker is a field the author fills after the code exists; it verifies attention, not structure. The allowlist inverts the default: a file under a storefront's `lib/` or `components/` exists only because the registry says why. Adding host logic then requires a registry edit in the same PR, which is the review event the current rule lacks. Severity path per ADR-0007 §2.6: WARN until wave 1 lands, BLOCK after.

## 6. Design canon — one canvas per capability

The same duplication exists in `design-source/` and confuses vendoring (tokens and artboards are pulled per file):

| Duplicate set                                                                      | What it is                                                                                                                  | Canon                                                                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor-events.dc.html` vs `webinars-listing.dc.html` (+ `webinars-month.dc.html`) | the same events feed drawn twice, one per host                                                                              | one `events-feed.dc.html` with a `host` prop (`витрина врача \| Академия`) — the pattern `webinar-page.dc.html` already uses (`header` prop)    |
| `doctor-docs.dc.html`, `academy-docs.dc.html`, `document.dc.html`                  | 028 documents index ×2 + reading page                                                                                       | one index canvas with a `host` prop + `document.dc.html`                                                                                        |
| `doctor-cabinet.dc.html`, `profile.dc.html`, `my-events.dc.html`                   | account surfaces                                                                                                            | `profile` + `my-events` are the R1 canon (owner: «копия ЛК из Академии»); `doctor-cabinet` is the 022 (R5) canvas and must say so in its header |
| `webinar-room.dc.html` vs `webinar-room-frame.dc.html` + `webinar-room-v2.dc.html` | the pre-#1123 room canvas next to the current pair (README: `-v2` is the artboard index composing `-frame` + `chat-column`) | keep `-frame`, `-v2` and `chat-column` as canon; move only `webinar-room.dc.html` to `design-source/archive/` with a pointer                    |
| `webinar-page-variant-a.dc.html`                                                   | a decision mockup (F-020-1)                                                                                                 | archive once the decision is recorded in the spec; decision mockups never stay next to canon                                                    |
| `auth.dc.html` (re-pulled)                                                         | one canvas, both hosts                                                                                                      | already canon — the model for the others                                                                                                        |

Rules (land in `design-source/README.md`, stage 1):

1. **One canvas per capability, host as a prop.** A capability both storefronts render has one `.dc.html`; host differences are props / fork panels, never a second `doctor-*` / `academy-*` file. Host-only screens (`doctor-feed`, `doctor-school`, `academy-invest`, …) keep their host prefix.
2. **Tokens only in `design-system.dc.html`.** No canvas redefines a colour, radius or type step; a canvas that does is a vendoring defect, not a design decision.
3. **Superseded and decision canvases move to `design-source/archive/`** in the PR that vendors the successor or records the decision; the README table lists only canon.
4. **Vendoring writes the registry row.** The PR that vendors a canvas names the feature package (not the host) that will build it; the registry row and the canvas table stay in sync.
5. **Owner draws once.** When a doctor screen equals an Academy screen, the request to the owner is «add the host prop / fork panel to `<canon>.dc.html`», never «draw the doctor version».

## 7. Backlog reconciliation (open Issues, 2026-09-07)

| Issue                      | Milestone             | Contradiction                                                                                | Action                                                                    | Owner fork? |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| #1485, #1516               | R1.1, worktrees exist | third feed / nearest-events compositions being built in `apps/doctor`                        | stop; either move to wave 2 or finish with `mirror-of`                    | **yes**     |
| #1520, #1524, #1525, #1526 | R1.1                  | calendar page, data states, «Прошедшие», «Мои события» repeat `apps/portal`; `Reuse:` empty  | `blocked_by` wave 2; `Reuse: extract-from apps/portal/...`                | no          |
| #1548, #1549, #1550        | R1.1                  | 021 EARS-12/13/14 are 003 behaviours live on the Academy                                     | close as duplicates of wave 1 after verifying each on the Academy         | **yes**     |
| #2001                      | R1.1                  | `Reuse:` names the doctor fork `apps/doctor/lib/auth-error-message.ts` as canon              | rewrite to `extract-from apps/portal/lib/auth-error-message.ts`           | no          |
| #1989                      | R1                    | `Reuse:` names the card only; `/reset` page rules (278 lines) unnamed                        | complete `Reuse:`; brief with `mirror-of`                                 | no          |
| #1768, #1769               | R1                    | `Reuse:` empty; Academy has `registration-handoff`, `return-to-origin`, `my-events`, one-tap | complete `Reuse:` before the brief                                        | no          |
| #1767, #1771–#1776         | R1.1                  | feature 020 «both storefronts» but `track:doctor`, would land on the doctor composition only | move to wave 3, `track:platform`                                          | no          |
| #1496–#1510 (018)          | R4                    | specialty feed = fourth feed composition                                                     | `blocked_by` wave 2; #1497 (content card) is genuinely new                | no          |
| #1973, #1652               | Академия · Позже      | portal-only fixes of shared surfaces                                                         | into wave 2                                                               | no          |
| #2002, #1874, #1907        | Platform              | detective controls                                                                           | #2002 → allowlist guard; #1874 / #1907 folded into the stage-1 guard work | no          |
| #1564                      | R1.1                  | registry-research guard blind to `apps/doctor` — detective control                           | folded into the stage-1 guard work; milestone moves to Platform with it   | no          |
| #1644                      | Platform              | `escapeLike` ×6 in `apps/api`                                                                | stays its own chore (stage 3, code), independent of the waves             | no          |
| #1972, #1996, #2005, #1987 | R1 / R1.1             | already `extract-from`                                                                       | keep; they are wave bricks                                                | no          |
| Registry rows 35, 44–46    | repo                  | license duplication                                                                          | stage 1 rewrite                                                           | no          |

## 8. Owner forks recorded so far

- Architecture: feature packages (decided by this spec after research; the owner asked for a recommendation, not a question — 2026-09-07).
- Fork A-1 (#1485 / #1516 in-flight handling) and fork B-1 (closing #1548–#1550 as duplicates) — both decided by the owner on 2026-09-07, verbatim: «Развилка А - 1. Развилка Б - 1. Помоему тут решения должны чётко отражать новую политику в отношении переиспользования функций. Зачем самим же плодить противоречия своим же правилам?». A-1: the two in-flight Issues are not finished on the host composition — #1485, #1516 (and #1520, #1524, #1525, #1526 with them) are `blocked_by` wave 2 (#2028), with a stop-state comment on the two in flight. B-1: #1548–#1550 are closed as duplicates of wave 1 (#2027), and #1987 / #2001 are `blocked_by` it.

## 9. Session protocol for this epic

A session on #2020 reads this file, picks the next unchecked item of the earliest open stage, and updates the checklist in the same PR. Progress lives here and in the epic's sub-issues; no handoff replaces the checklist.

## 10. Reviewer comments for specification revision — 2026-09-08

**Status: pending disposition.** Recorded at the owner's request in [#2044](https://github.com/doctor-school/ds-platform/issues/2044). These are recommendations for the next specification author, not approved architecture, a decision amendment, or a formal Mode (a) verdict. Stage 1 remains completed; the owner decisions in §8 and their tracking in #2027 / #2028 remain in force. The review used the plan, repository code and GitHub records; it did not run live user journeys.

**Overall assessment.** The task is worthwhile and feature packages are the right direction. It is a medium-to-large architectural refactor with high auth-regression risk. Without tighter boundaries, duplication can migrate into config, adapters and exceptions. Auth followed by events is a reasonable priority. Before broad extraction, the reviewer recommends a both-host behaviour matrix, typed package/config contracts, a dependency graph and explicit verification/release criteria for each wave.

**Handoff.** Address each REV ID with `accepted/resolved` and a link to the revised clause/evidence, or `rejected` and a rationale; an accepted but unfinished item remains pending with its tracking Issue. Apply accepted changes by rewriting the affected plan clauses inline, preserving requirement traceability and recorded owner forks. Reconcile dependent ADR/spec/registry wording where needed. Do not treat this review as authorization for a new product decision or reopen a closed owner fork without a concrete unresolved conflict.

### REV-01 — High: the allowlist does not enforce the full sharing boundary

**Affected:** §3 rule 3; §5. **Evidence / risk:** the proposed check covers only `apps/{portal,doctor}/{lib,components}` and file membership. Logic added to `app/**/page.tsx`, another directory such as `hooks/`, an already allowlisted file, or a host-config callback can pass. §1 itself identifies page-level compositions as a source of duplication. The allowlist is useful, but its stated structural guarantee is broader than its coverage.

**Requested specification change:** retain the allowlist and define complementary import/boundary checks: shared routes mount their registered package; packages never import apps; host config does not implement the shared scenario. State which guarantees are automated and which still require review.

- [ ] Specify coverage and negative cases for route-local logic, alternate directories, allowed-file growth, package-to-app imports and behavioural config callbacks.
- [ ] Define enforceable acceptance tests and any remaining review obligations, including their relation to the WARN-to-BLOCK transition.

### REV-02 — High: preserve both storefronts' behaviour and tests

**Affected:** §2 package contract; §4 Stage 2 common steps. **Evidence / risk:** moving Academy code and tests alone does not establish parity. Doctor-side flows already include specialty-based landing, stale-`returnTo` explanations, confirmation/consent states and a recorded divergence on automatic sign-in failure after email confirmation. Some differences are intended product behaviour; others require disposition. Stage B on both hosts is already required, but cannot replace regression coverage.

**Requested specification change:** prepare a matrix per wave: scenario → Academy behaviour → doctor behaviour → shared contract → permitted host difference → test. Inventory both hosts' tests before moving code; retain shared behaviour tests and host-mount/integration coverage for each host.

- [ ] Cover missing/success/failure branches, return-context recovery and the doctor-specific cases above; link each intended difference to its decision.
- [ ] State how both existing test sets map to package tests and per-host tests, without silently dropping doctor behaviour or relaxing Stage B.

### REV-03 — High: temporary-copy expiry conflicts with extraction timing

**Affected:** §2 bounded copy exception; §4 Stages 0 and 2. **Evidence / risk:** §2 forbids mirrors past R1, while Stage 2 starts the waves that remove them after R1. Both deadlines cannot hold for the same mirror. Stage 0 anchors source line ranges without pinning the source version.

**Requested specification change:** choose a consistent release sequence: either the relevant extraction blocks R1, or the exception expires at a named later wave/release with a checkable deletion condition. Record this disposition against the affected Issues. Pin every source anchor to a commit SHA as well as its path/range.

- [ ] Reconcile all mirror deadlines and name the extraction owner/Issue and deletion check for each allowed mirror.
- [ ] Specify immutable source provenance and the check for source changes between copying and extraction.

### REV-04 — Medium: define config, adapter and server/client boundaries

**Affected:** §2 route/config contract; §4 wave 1 inventory. **Evidence / risk:** arbitrary callbacks such as `onSuccess()` or `resolveLanding()` can conceal independent flow implementations. Next.js also needs middleware, metadata and server integration beyond a page mount. For example, `apps/portal/middleware.ts` parks `returnTo`, but the wave-1 inventory does not name it.

**Requested specification change:** provide typed package entry points and host-config/adapter contracts, with permitted adapter operations and shared ownership of decisions. Assign middleware, metadata, server actions, session forwarding and caching explicitly; separate server-only and client entry points and define thin framework mounts where necessary.

- [ ] Include allowed/disallowed config examples and distinguish transport adaptation from routing, authorization and state-machine decisions.
- [ ] Inventory framework entry points, including `apps/portal/middleware.ts`, and specify their package dependencies and server/client boundaries.

### REV-05 — Medium: sequence dependencies and independently verifiable steps

**Affected:** §4 Stage 2 wave table. **Evidence / risk:** wave-1 `registration-handoff` depends on `room-return`, listed in wave 4. `packages/events-storefront` already exists following #2005, and `registration-resume` already consumes its completion-on-return behaviour. The work is not four independent package moves; an incomplete move could recreate copies or require a package-to-app dependency.

**Requested specification change:** draw the actual dependency graph from current shared owners and split each large wave into small, complete PR steps. Define the valid intermediate state after every step, especially for login, registration, confirmation, recovery, session and theme in wave 1.

- [ ] Resolve the `registration-handoff` / `room-return` ordering and account for the existing `events-storefront` completion-on-return owner.
- [ ] Name each step's prerequisites, consumer migration and acceptance evidence; prohibit temporary package-to-app imports and duplicated rules used to bypass ordering.

### REV-06 — Medium: verify packaged runtime and define release/rollback criteria

**Affected:** §2 deployment rationale; §4 per-wave acceptance. **Evidence / risk:** package moves affect existing `transpilePackages`, CSS `@source`, standalone output and runtime-file inclusion. Type checks or source tests alone can miss missing styles/files in the built apps. Separate containers permit separate deployment, but do not by themselves prove release independence: the current deployment uses a shared SHA and service set.

**Requested specification change:** add both-app build/start and runtime smoke criteria to every affected wave, alongside existing behavioural and owner gates. Clarify actual deployment coupling, rollout unit, compatibility assumptions and rollback through the canonical deployment process.

- [ ] Require both standalone apps to build and start with required package files/styles, and verify affected routes plus same-origin auth/session behaviour.
- [ ] Define deployment order/unit, release evidence and rollback criteria; avoid promising independent releases without specifying how the current deploy supports them.

### REV-07 — Medium: retain every absorbed requirement's traceability

**Affected:** §3 rule 4; §4 Stage 3 docs cleanup; §7 duplicate/absorption actions. **Evidence / risk:** a projection line can replace duplicate prose only when the shared contract actually covers it. #2027 already records the requirement to always explain a disabled submit reason as lacking an Academy counterpart. Closing a duplicate Issue does not itself prove that all its clauses are preserved.

**Requested specification change:** map every absorbed EARS clause to its canonical requirement and shared test, retained host difference, or explicit owner-approved removal. Preserve the closed-Issue history and the §8 decision; trace unique clauses into the receiving wave instead of losing them during cleanup.

- [ ] Audit all absorbed Issues clause by clause, including #1548–#1550 and the disabled-submit requirement recorded in #2027.
- [ ] Keep stable source requirement IDs and links to receiving requirements/tests or the owner's removal decision; a projection line links to that mapping.

### REV-08 — Optional: separate canvas consolidation from behavioural extraction

**Affected:** §6 and §4 cleanup sequencing. **Evidence / risk:** sharing runtime behaviour does not technically require one physical canvas file. Combining canvases can introduce an unintended redesign or delay extraction while already approved variants exist.

**Requested specification change:** consider a separate canvas-consolidation workstream with explicit dependencies only where genuinely required. Preserve one component owner, approved host variants, design provenance and both-host parity. This suggestion does not waive the existing design canon, Stage A or Stage B; any change to that canon needs explicit disposition in the relevant documents.

- [ ] Record acceptance or rejection of decoupling and identify the actual design dependencies of each extraction wave.
- [ ] Ensure consolidation preserves approved variants and that any changed look/behaviour follows the existing owner gates.
