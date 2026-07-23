---
"@ds/design-system": major
"@ds/portal": minor
---

feat(006): Twitch-model webinar room — maximized player, viewport-bounded shell, collapsible minimal chat (#1123)

`WebinarRoomLayout` is reworked from the `1fr 400px` page-flow grid to a viewport-bounded flex shell: the page no longer scrolls, the player region is maximized (the embed iframe fills a dark letterbox, no custom player chrome — EARS-9), a one-line context strip sits under it, and the desktop chat is a 340px aside that collapses to a 44px rail with a live unread badge. The chat ledger becomes Twitch-minimal — borderless single-paragraph rows (no timestamps/avatars), `flex-col-reverse` stick-to-bottom with a «Новые сообщения ↓» chip, composer pinned. BREAKING: the primitive's props changed (new required `contextStrip`, `chatHeading`, `collapseLabel`, `expandLabel`; `context` now the mobile info-tab block; `player` is region content, not its own aspect box).
