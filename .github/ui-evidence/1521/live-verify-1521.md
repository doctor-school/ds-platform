# Live-verify — 019 EARS-6 «Идёт сейчас» block (Issue #1521, PR #1942)

Driven in a real Chromium against the production builds of `@ds/api` (`node dist/main.js`, `:3400`) and
`@ds/doctor` (standalone build, `:3404`) on the local dev stand, branch database `ds_dev_1521`. Nothing is
mocked and nothing is hand-composed: every PNG in this folder is a browser screenshot of that running build.

Seeded state: event `prp-questions` — «Эфир «Вопросы по PRP»», «Школа ортобиологии», `state='live'`,
ends 13:28 МСК; three `presence_beats` rows on it, deliberately forward-dated (`beat_at = now() + 8h`) so
«3 в комнате» survives the owner's Stage-B window. Four pre-existing seed live events had `starts_at`
shifted so that `prp-questions` is the earliest-live winner.

## (a) Guest — PASS

Block visible above the feed; pill `role="status"` reads «Идёт сейчас»; title «Эфир «Вопросы по PRP»» links
to `/events/prp-questions`; meta «3 в комнате · Школа ортобиологии · до 13:28 МСК»; the single action is
«Открыть страницу события» → `/events/prp-questions`. Zero `a[href$="/room"]` inside the block — a guest is
never offered the room.

## (b) Registered doctor — PASS

In-page `POST /v1/auth/login` → 200 for `stageb1521.doctor@example.test` (display name «Ирина Соколова»,
registered for `prp-questions`). The action becomes «Войти в комнату эфира» → `/events/prp-questions/room`,
and clicking it actually lands on `http://localhost:3404/events/prp-questions/room`.

## (c) Self-clearing on the bounded refresh — PASS

`data-refresh-seconds="30"`. Observed sequence, no page reload at any point
(`main_frame_navigations_during_wait: 0`), all polls `200`:

| t     | DB change                                               | next `GET /v1/storefront/doctor/events/live`                                | block                                  |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| 0 s   | `prp-questions` → `ended`                               | `200` body = `seed-006-room-youtube` («Прямой эфир: кардиология (YouTube)») | switches title in 31 s                 |
| +31 s | the four remaining `state='live'` seed events → `ended` | `200` body = `null`                                                         | disappears after 29 s                  |
| +60 s | all five rows restored to `state='live'`                | `200` body = `prp-questions`                                                | reappears with «Эфир «Вопросы по PRP»» |

The earlier «did not clear» observation was a seed-data artefact, not a defect: the branch database carries
five targeted live events, so ending one only makes the server hand back the next one. With every live event
ended the endpoint answers `200 null` and the block removes itself within one refresh cycle, with no reload.
All five rows were restored to their recorded `state='live'` afterwards (verified by re-select).

Cleared-state screenshot: `interactions-cleared-after-end.png`.

## (d) Accessibility — PASS

The strip is a `<section aria-labelledby=…>`; the «Идёт сейчас» badge carries `role="status"`, so the arrival
of a running эфир is announced without a live-region of the page's own.

## DOM order — matches the canvas

`data-events-feed` sits on the PAGE CONTAINER `<section>` (`apps/doctor/app/(storefront)/events/page.tsx`
L152–157), and `EventsLiveBlock` is nested inside it at L168 — before the mini-month pane (L179) and before
`EventList` (L188). The canvas has the same order (live section L166 precedes `miniMonthOn` L224). A DOM probe
comparing the block against `[data-events-feed]` therefore reports «block after feed» simply because the feed
attribute is on the ancestor; visually and structurally the block is first in the content column.

## Renders

| file                | viewport     | theme                               | frame                                                                             |
| ------------------- | ------------ | ----------------------------------- | --------------------------------------------------------------------------------- |
| `desktop-light.png` | 1440×950 @2x | light                               | `border-top-width: 2px`, `rgb(200,30,30)`, `box-shadow: rgb(200,30,30) 6px 6px 0` |
| `desktop-dark.png`  | 1440×950 @2x | dark (`html.dark` confirmed `true`) | same offset cast                                                                  |
| `mobile-light.png`  | 390×900 @2x  | light                               | `box-shadow: none` (desktop-only cast), wrapped — height 225 vs 108               |
| `mobile-dark.png`   | 390×900 @2x  | dark (`html.dark` confirmed `true`) | as above                                                                          |

## Interaction states

Captured per element with one CDP session per browser context (`CSS.forcePseudoState`), light and dark,
rest / hover / focus-visible / active — 16 PNGs, `interactions-{light,dark}-{action,title}-{rest,hover,focus-visible,active}.png`.
Measured deltas, no no-ops: the action's hard shadow moves 4px → 2px on hover and drops to `none` on active;
the title goes `rgb(17,77,158)` on hover and focus-visible, `rgb(13,58,119)` on active.
