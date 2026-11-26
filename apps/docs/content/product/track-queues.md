---
title: "Track queues"
description: "The owner's order of work per product track; pnpm bootstrap prints each track's next item from it."
---

# Track queues

The order in which each product track's Issues are taken, set by the owner. The lead changes it on the owner's word in one Ship-tier PR; titles, state, claims and blockers are never stored here — `pnpm bootstrap` and `pnpm backlog:triage` read them live from GitHub. A queue item is an outcome Issue — a feature parent or a delivery Issue — never a spec or discovery step; bootstrap expands a parent to its next open child.

A key is a track label without the `track:` prefix. A new track needs its key here, its `track:*` label, and its entry in the track taxonomy `tools/gh/lib/roadmap-taxonomy.mjs` (plus the PR-side copy in `tools/gh/sync-pr-track.mjs` and the `backlog:triage` track order) — without the taxonomy entry `pnpm issue:create` refuses the label.

<!-- prettier-ignore -->
```yaml
academy:
  goal: Новая главная Академии и посты из соцсетей в ленте
  queue: [1799, 1802, 1824, 3506, 3403]
doctor:
  goal: Наполнение пути — редактор вносит курс через админку, врач проходит его на сайте
  queue: [4018, 4272, 4014, 4274, 4013, 4015, 4020, 4021, 4022, 4016, 4023, 1497, 1500, 1501]
platform:
  goal: Ключевые действия старых фич проверяются на stage перед релизом
  queue: [4114, 4117, 4122, 4115, 4127, 4121, 4126, 4119, 4116, 4125, 4120, 4118, 4128, 4130]
migration:
  goal: Врачи старой платформы входят без регистрации; с конца января эфиры только на новой
  queue: [1825, 873]
```
