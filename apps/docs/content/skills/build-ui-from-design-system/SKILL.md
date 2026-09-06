---
title: "build-ui-from-design-system"
description: "Procedural skill (inline): the thin gate that runs the design-system-first cycle before any UI — reuse a covered element class from the design constitution, or research it (research-ui-element) first; adopt from the whitelist before bespoke; token-only; owner Stage A/B design approval; live-verify."
name: build-ui-from-design-system
mode: inline
---

# build-ui-from-design-system

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline (the lead agent executes this procedure itself).

The design system exists so we **do not reinvent the wheel**. This skill is the **thin gate** that runs the design-system-first cycle — it does not restate the standards themselves. Durable standards live in one store each, and this skill **points** at them:

- **[Design constitution](../../design/constitution.md)** — the per-element-class standards + research + citations (the _what_ and _why_).
- **ADR-0013 §7** — the decision (layered interaction/motion contract) + the CI guard catalogue.
- **`@ds/design-system` README** — the concrete token-only classes.
- **Living showcase** (`apps/showcase`) — every primitive/block rendered in every state (the Stage-A option surface + the Stage-B approval surface).

Canon: **ADR-0013** (including A1 cross-front capability ownership) + ADR-0004 §6.

## The design-system-first cycle (the default path)

Every UI-shaped task runs this loop; the gates below enforce each arrow:

> **element class covered in the constitution?** → **yes:** reuse the package export + consult the showcase (look) and constitution (rule) — no re-research. **no:** dispatch [`research-ui-element`](../research-ui-element/SKILL.md) → owner picks a rendered option (**Stage A**) → encode the standard into the constitution → build it into `@ds/design-system` as a token-only primitive/block, rendered in the showcase → owner approves live (**Stage B**) → feature composes from the package → **live-verify** → merge.

Features always compose from `@ds/design-system`; bespoke is the last resort, recorded.

## Canvas source → vendor it, build from it

Before dispatch or implementation of canvas-derived UI, read [canvas-source.md](canvas-source.md) in full. Every referenced canvas must be vendored from real source bytes with provenance; verify element and interaction-state fidelity before Stage B. Missing required live design capability is a prerequisite, never a fake export or an implied approval.

## When this applies

### Canvas-parity evidence contract (BLOCK)

Before preparing the PR or live-verification evidence, read [parity-evidence.md](parity-evidence.md) in full. Its source routes, current-head review binding and all profile-specific renders/interactions are mandatory; they never replace the owner Stage-B verdict.

Any task that creates or reshapes an interface — a page, form, control, layout, overlay, or an empty/error/loading state. **Classify by the touched SURFACE, not the GitHub label**: a `tooling` / `engineering-task` framing never exempts a user-facing look, and this **includes a catalogue / showcase / doc surface** that renders the design system itself (`apps/showcase/**`) — its look is a product decision too (memory `feedback_classify_by_surface_not_label`; the #348→#386 reopen).

It also includes a **UI-quality-fix round** (spacing / state / hover / reflow defects): research the best-practice values, encode them as a **primitive-level standard** in the constitution, never reactive per-page patches. **A styling fix repeated across ≥2 call-sites is decision-debt — lift it into a design-system primitive (ONE style source), never edit a per-page `className`** (memory `feedback_research_backed_ui_standards`; the #333 `FormError` lesson).

## Procedure

1. **Frame the capability + its states.** Name the complete product capability, not only its visible element: UI units, read model, state machine, mutations/actions, live/realtime behaviour and route-specific composition. Enumerate its content states (default / filled / invalid / loading / empty / disabled) **and interaction states** (hover / focus-visible / active / `cursor-pointer` on every clickable) per the ADR-0013 §7 contract. You adopt against the _states_, not a happy-path screenshot. For a DS primitive, run `pnpm lint:interaction-states` (#269) — it machine-checks the base-reset + hover/focus ring, but does **not** replace the live audit (step 9).
2. **Inventory sibling frontends before research.** Search every shipped frontend and shared package for the same product capability; record its current owner and named canonical target. A match means **reuse/extract first**: move app-local reusable code into the appropriate shared package/module and preserve one core contract and state machine. A thin host projection may add defaults, authorization/targeting, a response envelope, route, copy and composition only while delegating to that core. Never import one app from another, copy query/state logic or copy/fork UI. A deliberate divergence requires an explicit ADR-backed reason recorded in the Issue and PR.
3. **Reuse or research (the cycle's fork).** Is the element class already a `researched` section in the [constitution](../../design/constitution.md)? **Covered** → reuse the `@ds/design-system` export, read the constitution (rule) + showcase (look); skip to step 6. **Not covered** → dispatch [`research-ui-element`](../research-ui-element/SKILL.md); its returned section is the Stage-A artifact.
4. **Inventory owned code.** Check `@ds/design-system` (`tokens/`, `src/primitives/`, `src/blocks/`) and the shared domain/API packages found in step 2. Use what exists; don't re-create it.
5. **Registry-research gate (before any bespoke).** Search the committable whitelist and **report what you searched and found**: ① official **shadcn/ui** (Radix, incl. `input-otp`) · ② **Intent UI / JollyUI** (React-Aria) · ③ **Kibo UI**. (research-ui-element already did this for a freshly-researched class — cite its result.) **The adoption unit is the named UI PATTERN, not only the interactive element** — table/list, tabs, filter bar, form field group, select/combobox, pagination, empty state, dialog. A pattern absent from `@ds/design-system` means the slice FIRST copies the ready whitelist block into `src/blocks/` (+ showcase) and then instantiates it; hand-composing the pattern from primitives/divs IS bespoke and needs the recorded last-resort decision. **An app-local precedent is a reuse candidate, not permission to duplicate:** extract it to the owning shared package/module before a second frontend consumes it. Deterministic enforcement: #1579 (`blocks-adopted:` line per pattern). Precedent: PR #1575 passed the element-level gate while its tables/tabs/filters were hand-composed; the owner rejected the whole surface at Stage-B (2026-08-27) — the bespoke shell had self-legalized across slices 012→017.
6. **License guard.** Our product is proprietary (`UNLICENSED`; ADR-0008 §2.3 = source-available, not open-source). **MIT/permissive** (the whitelist) — adopt freely, preserve the upstream notice. **Proprietary/paid** (shadcnblocks, Shadcn Studio, shadcn Pro) — license **+** private repo only; while public, pattern-only. **Runtime UI-kits** (HeroUI, CoreUI, Syncfusion) — excluded (foreign runtime).
7. **Stage A satisfied → adopt → re-skin to tokens.** Install as owned code → re-skin token-only (no hardcoded colour/spacing/radius — lint-blocked) → place in `src/primitives/` or `src/blocks/`. Acceptance bar (ADR-0013): permissive license · correct RSC boundaries · a11y · no superfluous deps · maintenance freshness.
8. **App glue stays in the app.** BFF calls, i18n copy and routing stay in the app only when they are genuinely host-specific. A read model, state machine, action policy or realtime behaviour shared by multiple frontends belongs to a shared domain/API module; calling it "glue" does not legalise a second implementation.
9. **Live-verify.** Confirm the stand is up **yourself** (`pnpm dev:status`; bring it up if down — the box is power-cycled, never ask "is the box on?" — `.claude/rules/dev-stand.md`). Then drive the journey in a browser (Playwright): every clickable's hover (pointer cursor **and** style change) + Tab focus ring + active/disabled/loading, and **every branch** of an action, not just the green path (memories `feedback_verify_ui_on_live_stand`, `feedback_verify_every_field_kind_every_surface`). Build/typecheck/lint/Mode-a are necessary, not sufficient.
10. **Bespoke is the last resort** — only after the sibling-front inventory and registry search both come up empty, with both negative results recorded in the PR.

## Design-approval gate (user-facing surfaces)

**Stage A — before any UI code.** After research and before step 7, read [design-approval.md](design-approval.md) in full and obtain or verify the owner's exact recorded design choice. Existing upstream approval applies to its scope; new layout, look or changed behavior still needs the owner decision. Neither a tooling label nor passing tests grants it.

**Stage B — after live verification, before merge.** Follow that same reference's complete stand, handoff and recorded-evidence checklist. Keep the owner stand alive until the verdict. Missing approval blocks merge; only the two precisely recorded behavioral-only/batched carve-outs apply. Canvas parity and Mode-a do not substitute for the owner's live decision.

## Output

- An explicit **reuse/adoption decision** in the first reply + PR body: `cross-front reuse: <canonical capability> from <owner>` plus `adopted <block> from <registry>`, or `bespoke — sibling-front inventory + toolbox search returned no fit because …`. The registry citation remains machine-checked by `registry-research`.
- Adopted/bespoke code lives in `@ds/design-system`, token-only, live-verified; a freshly-researched class also lands a constitution section.

## Failure modes

- **Hand-writing a scaffold without the registry search** (the #235 `AuthCard` sin), or **concluding the landscape from one link** — the whitelist exists so the search is complete.
- **Copying an Academy/Doctor capability into the other app** instead of extracting and consuming one canonical implementation, or calling shared live/read/state behaviour app-local glue.
- **Committing proprietary-registry code into a public repo** (pattern-only there).
- **Skipping Stage A / inverting the gate** — entering UI implementation, or surfacing the design last as a green PR, with no recorded owner sign-off; a handoff "approved" is unverified.
- **Chat prose / a wireframe instead of triggering the owner's taste-work in claude.ai/design** (Stage A), or **a static screenshot instead of a live URL** (Stage B) — the owner picks/approves from what they can see and drive.
- **Skipping the constitution/research visual-direction and interaction-state audit** — clickables with no hover feedback or an arrow cursor.
- **A PNG/JPG product asset or a white-chip logo when a clean variant exists** (ADR-0013 §8).
- **Declaring "done" on build/lint/review without a browser live-verify.**
- **Re-researching an already-covered element class** instead of reusing its constitution section.
