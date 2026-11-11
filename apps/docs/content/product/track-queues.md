---
title: "Track queues"
description: "The owner's order of work per product track; pnpm bootstrap prints each track's next item from it."
---

# Track queues

The order in which each product track's Issues are taken, set by the owner. The lead changes it on the owner's word in one Ship-tier PR; titles, state, claims and blockers are never stored here — `pnpm bootstrap` and `pnpm backlog:triage` read them live from GitHub.

A key is a track label without the `track:` prefix; a new track needs only a new key here and its label.

```yaml
academy:
  goal: Новая главная Академии
  queue: [3516, 3517, 3943, 3944, 3505, 1802, 1824, 3506, 1799]
doctor:
  goal: Выложить курс — врач проходит его на сайте
  queue: [2272, 1792, 1793, 1497, 1500, 1501]
```
