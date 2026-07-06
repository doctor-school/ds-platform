---
title: "report-task-outcome"
description: "Procedural skill (inline): the fixed end-of-task report shape — product-first impact, a MANDATORY 'visual to check' line (a rendered before/after DELIVERED to the user, or an explicit 'nothing visual + how to verify'), a 'why this surfaced' context line, and a collapsed technical appendix. Carries the reusable render-and-deliver-a-visual recipe."
name: report-task-outcome
mode: inline
---

# report-task-outcome

**Kind:** procedural · **Mode:** inline (the lead agent runs this when reporting a finished task).

**Why:** engineering-jargon-first completion reports buried whether the user had anything to check — the user repeatedly had to ask "is there something visual I can verify?" and "where do I look?". This skill makes the report **product-first** and makes the visual proof a **delivered, non-optional** element.

## When this applies

At the end of any task you report to the user (a merged PR, a completed engineering-task, a closed Issue). Reuse the **context line** (§4) and the **visual-delivery recipe** for any mid-task decision request too.

## The report shape (fixed)

1. **✅ #N — title · status** (merged / closed / blocked).
2. **Для пользователя (plain language):** the product / user-visible impact in 1–3 sentences, no jargon — what a person would actually notice.
3. **🖼 Проверить глазами — MANDATORY, always exactly one of:**
   - `ДА → <path / URL>` with a rendered **before/after** (for ANY task that changed visible UI — always, don't wait to be asked), **delivered to a user-visible location** (see recipe). For UI/DS-visual work the value is a **LIVE URL** you boot yourself from fresh `main` BEFORE reporting (showcase `/blocks` for DS units, the portal page for screens); a screenshots folder / before-after images are a supplement to the URL, never its substitute (memory `feedback_live_url_not_screenshots`), or
   - `НЕТ — backend/infra/agent-internal; проверяемо так: <test / behaviour / command>`. For a **hook-driven / agent-internal** deliverable (runs automatically in SessionStart, a guard, etc.) phrase the verify line as the **automatic trigger** — "работает само при старте сессии, тебе делать ничего не нужно" — never "запусти X" (the user reads a bare command as a new per-session chore).
4. **Откуда всплыло / где в очереди:** one line of task-chain context (which epic/issue, why now) — on the report AND on any mid-thread decision request.
5. **Трекер:** PR #, Issue #, board Status, what was unblocked/closed.
6. **▸ Технически (collapsed appendix, at the END):** files, tokens, changeset, CI — full detail on request only. The report reads as a product report, not a diff.
7. **Дальше / отложено:** next queue item, deferred items + why.

## Owner-question shape (mandatory gate)

Any question you put to the owner — in the report **and** in the `⏸ ЖДУ ВАС: <одно действие>` handback line — renders as a self-contained block, four beats: **что случилось / почему спрашиваю / что изменит ответ / где посмотреть** (a live URL, or a concrete page — never "look at the diff"). **Banned:** jargon (token names, internal process terms) and any «см. Issue/отчёт» redirect that makes the owner go read something to parse the question — an Issue number is allowed only as a parenthetical aside. Before releasing the report, self-check **each** question against this form: an owner who has read nothing else must be able to answer it. Precedent: the 2026-07-06 checkpoint asked 4 questions in internal shorthand; the owner could not parse 3 of them, and the re-ask cost a full round-trip.

## Visual-delivery recipe (reused by build-ui Stage-B supplements + mid-task decision visuals)

A confirmation or report visual the user **cannot see** is worthless — images you `Read` render only in your own CLI, not to the user. To produce and DELIVER one:

1. **Build the artifact** — render the real surface, or a focused HTML mock of the change (real tokens + Inter), on a local server. **`file://` is blocked in the Playwright MCP**, so `python -m http.server <port> --bind 127.0.0.1` and navigate to `http://127.0.0.1:<port>/`.
2. **Screenshot** via Playwright (`browser_take_screenshot`, full page). The MCP saves into the repo root — **`mv` it out** and confirm `git status` is clean (never leave preview PNGs in the repo).
3. **Deliver to the user** — copy to a local, user-visible folder OUTSIDE git (machine-specific path in memory `feedback_final_report_format`, e.g. `Pictures\<task-slug>\`) and **open it** (`cmd //c start "" "<path>"`). Never ask «подтверждаешь?» / "approve?" while the image is visible only inside your own CLI.
4. For a change to visible UI, make it a **before/after** pair (old vs new, side by side), not only the final state.
5. Tear down the local preview server (free the port) when done.

## Output

- A report in the fixed shape above, with the «🖼 Проверить глазами» line never omitted.
- For a visible-UI task: a before/after image delivered to a user-visible folder and opened.

## Failure modes

- **Asking for visual confirmation while the screenshot is only in the agent's CLI** — the user cannot see `Read` images; deliver to a folder and open it.
- **Engineering-jargon-first report** with no product framing and no explicit visual-to-check line.
- **Omitting the before/after** for a visible-UI change, or showing only the "after".
- **Opening a decision request mid-thread with no "why this surfaced" context.**
- **An owner question in internal shorthand** — jargon, a token name, or a «см. Issue/отчёт» redirect instead of the self-contained что-случилось / почему / что-изменит / где-посмотреть block.
- **Leaving preview PNGs in the repo root** (the MCP saves there) — `mv` them out, keep `git status` clean.

## Related

- [build-ui-from-design-system](../build-ui-from-design-system/SKILL.md) — Stage-B supplement screenshots (the live URL stays the primary deliverable) reuse this visual-delivery recipe; the Stage-A look pick lives in claude.ai/design, not here.
- memory `feedback_final_report_format` — the machine-specific artifact path + render recipe + pointer back here.
