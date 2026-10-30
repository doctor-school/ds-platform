---
title: "report-task-outcome"
description: "Procedural skill (inline): the fixed owner-facing report — what changed for a doctor/admin/sponsor in their words, what I need from you (or «ничего»), what is next, and a collapsed technical appendix that is the only place for ids and paths."
name: report-task-outcome
mode: inline
---

# report-task-outcome

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline (the lead runs it when reporting to the owner).

## When this applies

Every owner-facing text: the end of a task or session, a wave closeout, an interim status, a mid-task question, and the `## Progress so far` section of a [handoff-prompt](../handoff-prompt/SKILL.md). `AGENTS.md` §6 «Finish the PR tail» makes it the closing step of every PR. Read this file at report time; a report written from memory of the shape degrades into a list of numbers.

## Words

Use only words the owner used and product nouns (врач, админ, спонсор, вебинар, регистрация, форма события). No internal term, even glossed: no process names, tool or library names, guard names, `#N`, PR, SHA, EARS, branch or path outside the appendix. A vendor the owner must act on is named once with who it is to us. Owner-facing steps get the plain phrase: «скриншоты», «ссылка на тестовый стенд», «одобрение».

## The report (four parts, fixed order)

1. **Что изменилось.** For each landed unit, one line that opens with the product entity and what a doctor, admin or sponsor can now do or will notice — 1–3 sentences in total. Merged and live on the site are stated separately; «на сайте» only with release evidence in the appendix. A claim that something does not exist yet is made only after searching `apps/portal`, `apps/doctor`, `packages/` and the capability registry (`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`); the appendix names what was searched. For a visible change, deliver the before/after or the stand link per [visual-delivery](./visual-delivery.md); with no visible change say «смотреть глазами нечего» and how it is checked — never PR links in its place. Say «работает само» only for an automatic trigger you observed running; never claim an untrusted or unobserved hook runs by itself.

   **This paragraph is the release note — mirror it verbatim into the PR body's `## Product note (RU)` section** (`.github/PULL_REQUEST_TEMPLATE.md`), which the merge-time Mattermost delivery renders: the report and the team's release note are the same text, authored once. Write `none` there only for an internal-only PR (chore/CI/refactor/deps); the `product-note` guard fails `none` on a `feature`/`bug` PR.

2. **Что нужно от тебя** — or «ничего». Ask only what the owner decides (AGENTS.md §7) and what the agent cannot check itself. One question per message, self-contained: what happened, why I ask, what the answer changes, where to look (a stand link or a concrete page, never «see the Issue»), the options and my recommendation. A stand handed over carries a login that works on the first click.

3. **Что дальше.** The next step and why, in product words; what is deferred and why.

4. **▸ Технически** (collapsed, at the end) — the only place for `#N`, PR, SHA, EARS, migrations, paths and CI. It holds: requested outcome vs actual state (achieved / partial / not achieved, with evidence and the remaining acceptance conditions; merge and production separately, a release claim with its tag or deployed SHA); tracker counts as closed/total tasks with the scope named, never a percentage of product readiness; for a partial cut of a canvas-approved screen, each element still absent and where it lands, also said in one plain sentence in part 1; files, changeset, CI.

## Failure modes

- A line built from identifiers instead of a product fact.
- An internal term in parts 1–3, glossed or not.
- A question the agent could have answered itself, or a lead decision (anything off the AGENTS.md §7 owner list) pushed to the owner.
- A visual the owner cannot see (shown only inside the agent's CLI), or PR links offered as the thing to look at.
- A `feature`/`bug` PR with `## Product note (RU)` empty or `none`.

## Related

- [visual-delivery](./visual-delivery.md) — render, capture and deliver a before/after the owner can open.
- [build-ui-from-design-system](../build-ui-from-design-system/SKILL.md) — the Stage-A look pick and the per-tier owner check.
