---
title: Wave-1 entry gate — auth-flow behaviour matrix, EARS disposition, PR sequence
status: Draft — blocks wave 1 (#2027) until every row has a test id and an explained difference
---

# Wave-1 entry gate — `@ds/auth-flow`

## 1. Purpose and established facts

This is the wave-entry gate required by `2026-09-07-one-code-two-storefronts-plan-en.md` §4 («Wave-entry gate», the paragraph opening «The wave Issue carries a **behaviour matrix**»). No PR of wave 1 opens until every row below carries a test id and an explained difference.

- Scope: the auth surfaces of both storefront hosts — Academy (`apps/portal`) and doctor (`apps/doctor`) — that wave 1 folds into `packages/auth-flow`. That package does not exist yet; this document is slice 0 of #2027 and creates no code.
- `grep -rn "mirror-of:" apps/doctor` returns **0 matches** today. Step (d) of the four wave steps (§4, «(d) `mirror-of` markers for that capability are gone») is therefore satisfied by construction for wave 1 and must not be re-invented as work.
- Shell hand-off: #2180 already moved `components/header-user-cluster.tsx` and the theme unit into `packages/storefront-shell`. The shell exposes the auth cluster as a host-config slot; **wave 1 fills that slot**, it does not own theme or header chrome. The §4 wave-1 table still lists `header-user-cluster` and `theme` under «Moves from `apps/portal`» — superseded by #2180, and PR 1.2 of the §4 sequence is already delivered.
- Already shared before wave 1: `packages/design-system/src/blocks/{smart-captcha,bot-protection-field,use-bot-protected-action,bot-protection-error}.tsx` (registry row «Bot protection (client half)», `capability-ownership.md:44`), `blocks/pending-registration.ts` (held-password slot, row 42), `blocks/registration-success-card.tsx` (row 43), the auth cards / shell blocks (row 41). Wave 1 owns the **compositions**; design-system keeps the **cards** (§3 rule 1).
- Design entry: `design-source/auth.dc.html`, the ONE host-switched auth canvas (props `host`, `captcha`, `error`), vendored 6cb9930f — the §4 canvas precondition (#2080 → #2027) is met. Owner, 2026-09-15 on #2027: the captcha plaque in that canvas is a **placeholder** for the Yandex SmartCaptcha widget; the package mounts the existing `smart-captcha` / `bot-protection-field` blocks. The canvas fixes only the slot geometry and the four states «не пройдена» (submit disabled) / «пройдена» / «истекла» / «сбой» — our copy and submit-blocking rules. ui-parity excludes the widget box itself.

## 2. Behaviour matrix

One row per scenario. `Allowed difference` takes exactly one of: `none` · `config: <field>` · `product divergence: <ref>` · `convergence: <owner quote/date>` · `OPEN — owner Stage-A`. Every `OPEN` row and every row without a test id is repeated in section 5.

Anchors are `file:line` in this repository at `553ef3be`. A cell that could not be anchored reads `UNVERIFIED — <why>`, never a guess.

### 2.1 PR 1.1 — `room-return` codec into `@ds/room`

| #   | Scenario | Academy behaviour (file:line) | Doctor behaviour (file:line) | Shared contract | Allowed difference | Test id(s) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A canonical `/webinars/<slug>/room` target is parsed and the canonical room path reconstructed | `apps/portal/lib/room-return.ts:47` `parseRoomReturnTarget` | absent (flag off) — this host serves no room route; its room read is `apps/doctor/lib/room.ts:33` | ONE room-return codec in `@ds/room`; the host supplies the route template | `config: routes.room` (path template; `undefined` = no room on this host) | `apps/portal/lib/room-return.test.ts:21` |
| 2 | A bare event page (no `/room` suffix) is NOT a room return | `apps/portal/lib/room-return.ts:47` | absent (flag off) | same codec | `config: routes.room` | `apps/portal/lib/room-return.test.ts:29` |
| 3 | A cross-origin / open-redirect / traversal room target, and a non-string, are rejected | `apps/portal/lib/room-return.ts:67` `isSafeRoomReturnTarget` | the same guard, reached through `apps/doctor/lib/return-context.ts:133` `resolveReturnTargetPath` | one same-origin guard — `parseReturnTarget` in `@ds/schemas` | none | `apps/portal/lib/room-return.test.ts:33`, `apps/portal/lib/room-return.test.ts:70` |
| 4 | A doctor-feed-shaped target is not a room return on the Academy host | `apps/portal/lib/room-return.ts:47` | n/a — the feed shape is this host's own (`apps/doctor/lib/return-context.ts:120`) | one codec, host-scoped route table | `config: routes.room` | `apps/portal/lib/room-return.test.ts:50` |
| 5 | A room href is built from a slug, escaping a hostile slug so it can never front a cross-origin target | `apps/portal/lib/room-return.ts:78` `buildRoomReturnHref` | absent (flag off) | same builder | `config: routes.room` | `apps/portal/lib/room-return.test.ts:76` |
