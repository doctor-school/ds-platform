# @ds/portal

## 0.14.2

### Patch Changes

- [#1114](https://github.com/doctor-school/ds-platform/pull/1114) [`2a93282`](https://github.com/doctor-school/ds-platform/commit/2a93282821814ce2d0b08f6cdf96e9f21df76739) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(portal): the logged-in «Участвовать» one-tap CTA now registers via a real
  `<form>` + server action, so it works before hydration — on a weak network where
  the JS bundle is slow or fails to load, the button is no longer dead. The hydrated
  path keeps today's in-place one-tap (client POST + `router.refresh()`, no
  navigation); both arms are server-side idempotent (005 EARS-1/EARS-3).

- [#1116](https://github.com/doctor-school/ds-platform/pull/1116) [`62892f6`](https://github.com/doctor-school/ds-platform/commit/62892f683c34885bb02b760480f4fb68b0283c7e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix: the alphanumeric registration / password-reset verification code no longer traps mobile users on a digits-only keyboard ([#1110](https://github.com/doctor-school/ds-platform/issues/1110)). `OtpField` (and `OtpFocusScreen`, which forwards it) gain a **required** `charset: "alphanumeric" | "numeric"` prop: the slotted variant now requests `inputMode="text"` + `autoCapitalize="characters"` for alphanumeric codes so a phone shows the full keyboard, and `inputMode="numeric"` for the digit login OTP. `/verify` and `/reset` pass `charset="alphanumeric"`; `/login` passes `charset="numeric"`.

  BREAKING (`@ds/design-system`): `charset` is a required prop on `OtpField` and `OtpFocusScreen` — every slotted call site must declare its code's character set (no silent default, so no surface can inherit the wrong mobile keypad).

- Updated dependencies [[`62892f6`](https://github.com/doctor-school/ds-platform/commit/62892f683c34885bb02b760480f4fb68b0283c7e), [`c717a70`](https://github.com/doctor-school/ds-platform/commit/c717a70e3c587ffbec36239bc030d64dc724f765)]:
  - @ds/design-system@3.0.0

## 0.14.1

### Patch Changes

- [#1081](https://github.com/doctor-school/ds-platform/pull/1081) [`7bc26d2`](https://github.com/doctor-school/ds-platform/commit/7bc26d26c61faa1ba39ce331eebb7e93c9bf8321) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(portal): /verify «Не удалось определить аккаунт» error now says «Зарегистрируйтесь заново, чтобы получить новый код, или войдите в существующий аккаунт» — the old «Откройте ссылку из письма» wording contradicted the code-only verification contract (003-design §13).

- [#1106](https://github.com/doctor-school/ds-platform/pull/1106) [`ed20987`](https://github.com/doctor-school/ds-platform/commit/ed20987d218db527e1b419a6843521fe032c8adf) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Unify the discovery front-door on one canonical route (owner verdict [#7](https://github.com/doctor-school/ds-platform/issues/7) follow-up, [#1105](https://github.com/doctor-school/ds-platform/issues/1105)). `/` now permanent-redirects to `/webinars`, and nav «Эфиры» + the logo point straight at `/webinars` — a single listing route with the «Неделя / Месяц» switchers, retiring the second, switcher-less front-door hero.

- [#1079](https://github.com/doctor-school/ds-platform/pull/1079) [`5b725d7`](https://github.com/doctor-school/ds-platform/commit/5b725d733f653a6d45cc8c2bffaba85764aaad26) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#2](https://github.com/doctor-school/ds-platform/issues/2) ([#1075](https://github.com/doctor-school/ds-platform/issues/1075), owner verdict [#2](https://github.com/doctor-school/ds-platform/issues/2) at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): a day cell's muted background now marks weekends and out-of-month filler ONLY — an empty weekday keeps the card surface (the date ink keeps the canvas past/weekend/empty rule); the legend's bottom-right month link is always-on and always targets the displayed month + 1 (year boundary included), no longer derived from per-month event counts.

- [#1083](https://github.com/doctor-school/ds-platform/pull/1083) [`4e09ff2`](https://github.com/doctor-school/ds-platform/commit/4e09ff212b6fb808f4e0c7b70cf72f1b84cc3f8c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#3](https://github.com/doctor-school/ds-platform/issues/3) ([#1080](https://github.com/doctor-school/ds-platform/issues/1080), owner verdict [#3](https://github.com/doctor-school/ds-platform/issues/3) at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): the calendar surfaces (month grid, week listing, hero inner bands) span the full canvas 1240px content column at desktop, and the app-shell header renders the canvas light-theme blue `#2D84F2` — one continuous band with the hero poster (both via `@ds/design-system` tokens, no component change); the month-fidelity e2e pins the 1240px grid content width, the header/hero colour seam in both themes, and the live pill's 700 text weight. AA on the light blue.500 band (owner pick, Mode-a): the desktop nav links enlarge to the WCAG large-text tier (`text-xl` 20px, weight 700 — the ≥3:1 large/bold carve-out; underline-active treatment unchanged), and the white header chips (Войти / avatar / mobile ≡) switch their ink from `header` to the new `header-chip-foreground` canvas navy `#114D9E` (8.14:1 on white, both themes).

- [#1101](https://github.com/doctor-school/ds-platform/pull/1101) [`6b6b36f`](https://github.com/doctor-school/ds-platform/commit/6b6b36f4267a96bb696a98acdf53024a7037d3cd) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#4](https://github.com/doctor-school/ds-platform/issues/4) (004, [#1098](https://github.com/doctor-school/ds-platform/issues/1098)): the «Неделя» and «Месяц» panes of
  `/webinars` now share one static `CalendarShell` — a single navy hero + 1240px
  content column — so switching views no longer jumps the header band or column
  edges (owner verdict [#3](https://github.com/doctor-school/ds-platform/issues/3)). The month toolbar's picker trigger, ‹ › pager and
  «Сегодня» adopt the DS `Button` `outline` states; the view switcher's inactive
  segment adopts the `Button` `ghost` states (owner verdicts [#1](https://github.com/doctor-school/ds-platform/issues/1)/[#2](https://github.com/doctor-school/ds-platform/issues/2)). The month picker
  now pages years in place across a displayed-year ±1 window (owner verdict [#4](https://github.com/doctor-school/ds-platform/issues/4)), and a
  future month shows a «← <prev month>» return link (owner verdict [#5](https://github.com/doctor-school/ds-platform/issues/5)). The `/`
  front-door listing is unchanged.

- [#1104](https://github.com/doctor-school/ds-platform/pull/1104) [`2ff3a77`](https://github.com/doctor-school/ds-platform/commit/2ff3a77344b9f691603f8f433a57d4a7a3adbaf3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#5](https://github.com/doctor-school/ds-platform/issues/5) (004, [#1102](https://github.com/doctor-school/ds-platform/issues/1102), owner verdict [#6](https://github.com/doctor-school/ds-platform/issues/6)): three fixes. (1) The
  month toolbar's four controls (picker trigger, ‹, ›, «Сегодня») now render one equal
  height. (2) The «Неделя» pane's list body gains desktop top clearance so its first
  day-group heading no longer rides up onto the navy hero band — a regression from
  [#1098](https://github.com/doctor-school/ds-platform/issues/1098)'s shared-`CalendarShell` unification; the shell geometry (hero/column/switcher)
  is unchanged. (3) The picker year ‹ › stepper now pages in place for ≥3 consecutive
  steps in either direction before any edge (window widened to displayed year ±3), and
  the edge-fallback navigation re-centres on the year just BEYOND the edge so the step
  always advances instead of re-centring on the year already displayed.

- [#1094](https://github.com/doctor-school/ds-platform/pull/1094) [`77931ba`](https://github.com/doctor-school/ds-platform/commit/77931bae0b435ae6af9238a9d195c95b8ab5638e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Navy light-theme top ([#1085](https://github.com/doctor-school/ds-platform/issues/1085), owner verdict [#4](https://github.com/doctor-school/ds-platform/issues/4) at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): the desktop app-shell nav links revert from the [#1083](https://github.com/doctor-school/ds-platform/issues/1083) large-text tier (`text-xl`) to their pre-[#1083](https://github.com/doctor-school/ds-platform/issues/1083) size — `font-bold` (700) inheriting the nav container's `text-sm` (14px). On the now-navy blue.700 header band the inactive `opacity-80` tier composites to ≥6:1 (the historical AA-clean state), so the reds the [#1083](https://github.com/doctor-school/ds-platform/issues/1083) flip introduced on the resting nav tier and the theme-toggle glyph dissolve. No behavioural change beyond size/weight; press-state re-anchoring ([#1007](https://github.com/doctor-school/ds-platform/issues/1007)) untouched.

- Updated dependencies [[`6e69dca`](https://github.com/doctor-school/ds-platform/commit/6e69dca014cddd58fe3d3fb3948dfe1b24143540), [`5b725d7`](https://github.com/doctor-school/ds-platform/commit/5b725d733f653a6d45cc8c2bffaba85764aaad26), [`4e09ff2`](https://github.com/doctor-school/ds-platform/commit/4e09ff212b6fb808f4e0c7b70cf72f1b84cc3f8c), [`6b6b36f`](https://github.com/doctor-school/ds-platform/commit/6b6b36f4267a96bb696a98acdf53024a7037d3cd), [`2ff3a77`](https://github.com/doctor-school/ds-platform/commit/2ff3a77344b9f691603f8f433a57d4a7a3adbaf3), [`77931ba`](https://github.com/doctor-school/ds-platform/commit/77931bae0b435ae6af9238a9d195c95b8ab5638e)]:
  - @ds/design-system@2.0.0

## 0.14.0

### Minor Changes

- [#1058](https://github.com/doctor-school/ds-platform/pull/1058) [`036ad36`](https://github.com/doctor-school/ds-platform/commit/036ad361041800f28509077c53c5f2abc4fb0651) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): 004 EARS-19 — month-calendar view at `/webinars?view=month` (desktop 7-column grid, mobile dot-grid + selected-day agenda). Adds the display-only `MonthCalendarGrid`, `MonthDotGrid`, and `DayAgenda` presentation blocks to `@ds/design-system` (token-only, catalogued in the showcase), and wires the portal pane: current-МСК-month projection read, live pill/dot from `EventLifecycleState`, muted past-day notes, today outline, state legend, and the «Неделя / Месяц» switcher ([#1050](https://github.com/doctor-school/ds-platform/issues/1050)).

- [#1060](https://github.com/doctor-school/ds-platform/pull/1060) [`952645b`](https://github.com/doctor-school/ds-platform/commit/952645b4ea780989996d4a1e00a18ec8e0718fde) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): 004 EARS-17/18 — month navigation (‹ › paging + 12-month picker) and the «Неделя / Месяц» view switcher on `/webinars?view=month`. Adds the display-only `MonthPicker` presentation block to `@ds/design-system` (native `<details>` disclosure, year ‹ › stepper, per-month event counts, past months muted «прошёл»; token-only, catalogued in the showcase) and wires the portal month toolbar: server-component query-param paging (validated `month`, absent/malformed → current МСК month), the `MonthlyEventCount` picker feed, a «Сегодня» reset, and the shared `ViewSwitcher` that carries the displayed month so the week↔month round-trip is loss-free ([#1051](https://github.com/doctor-school/ds-platform/issues/1051)).

### Patch Changes

- [#1062](https://github.com/doctor-school/ds-platform/pull/1062) [`a6a5f9b`](https://github.com/doctor-school/ds-platform/commit/a6a5f9bd00d79da0433d50ee5e6dba721154ed33) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(portal): /account «Сменить пароль» helper now says «Отправим код для сброса пароля на email» — the old «ссылку» wording contradicted the code-only reset contract (003-design §13.4).

- [#1007](https://github.com/doctor-school/ds-platform/pull/1007) [`1981366`](https://github.com/doctor-school/ds-platform/commit/198136699afedd5f1718d5e38efcf0e441cf9483) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Portal header: immediate post-login auth affordance (no hard reload) + silhouette avatar fallback for no-display-name doctors

- [#1034](https://github.com/doctor-school/ds-platform/pull/1034) [`acd1f38`](https://github.com/doctor-school/ds-platform/commit/acd1f388bae4b39e02f46d6409ef07bd27b404b8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The /login, /register and /reset page titles now render as a real `h1` heading (exactly one per page) instead of a plain `div`, so screen readers and assistive tech see the page structure. Purely semantic — the visual rendering is unchanged.

- [#1072](https://github.com/doctor-school/ds-platform/pull/1072) [`3f9cca7`](https://github.com/doctor-school/ds-platform/commit/3f9cca7cead1783cf956f9d6fa6249e9246d52e4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view canvas-parity rework ([#1065](https://github.com/doctor-school/ds-platform/issues/1065), Stage-B verdict at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): 1240px calendar column, toolbar overlapping the hero band, kicker-free hero on the `hero` token with the canvas tagline (shared with the week listing), 3-pill day cap with the «+N ещё» link into the week listing's new per-day anchors, next-month legend link, and the canvas mobile toolbar arrangement.

- [#1037](https://github.com/doctor-school/ds-platform/pull/1037) [`ce1efe0`](https://github.com/doctor-school/ds-platform/commit/ce1efe039ac0443c926e6a5263c34e8141c375ff) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The /verify page title now renders as a real `h1` heading (exactly one on the page) instead of a plain `div`, matching the /login, /register and /reset fix — screen readers and assistive tech now see the page structure. Purely semantic — the visual rendering is unchanged.

- Updated dependencies [[`036ad36`](https://github.com/doctor-school/ds-platform/commit/036ad361041800f28509077c53c5f2abc4fb0651), [`3f9cca7`](https://github.com/doctor-school/ds-platform/commit/3f9cca7cead1783cf956f9d6fa6249e9246d52e4), [`952645b`](https://github.com/doctor-school/ds-platform/commit/952645b4ea780989996d4a1e00a18ec8e0718fde), [`0cbe990`](https://github.com/doctor-school/ds-platform/commit/0cbe9904884bcf6d6b2e4801e3f85726be549cc7)]:
  - @ds/design-system@1.3.0
  - @ds/schemas@1.4.0

## 0.13.2

### Patch Changes

- [#921](https://github.com/doctor-school/ds-platform/pull/921) [`b9d81e6`](https://github.com/doctor-school/ds-platform/commit/b9d81e60ee711e37f5940743db54c75eb09174e9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the verification email's CTA dead-end ([#904](https://github.com/doctor-school/ds-platform/issues/904)): the button now points at `/verify#email=<address>` — the identifier rides the URL fragment (never sent to the server, so the [#869](https://github.com/doctor-school/ds-platform/issues/869) mail-scanner-prefetch invariant holds), so a cold email-button open seeds the account and the code submits. The portal `/verify` screen now seeds the email from the fragment (query `?email=` kept as a same-tab/backward-compat fallback) and a validation-blocked submit (e.g. no identifier) surfaces a visible localized error instead of a silent no-op.

## 0.13.1

### Patch Changes

- [#850](https://github.com/doctor-school/ds-platform/pull/850) [`41419d3`](https://github.com/doctor-school/ds-platform/commit/41419d369f3403b0bb736223d5878e6a215a876c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix: [#843](https://github.com/doctor-school/ds-platform/issues/843) live surfaces track lifecycle in real time — public event-page and upcoming-broadcasts SSR reads drop the 30s timer cache (`cache: "no-store"`; any future cache must be invalidated ON the lifecycle transition, never by timer), and the room-chat pane shows a distinct loading skeleton while the history bootstrap is in flight instead of flashing «Пока нет сообщений» over an active conversation

## 0.13.0

### Minor Changes

- [#818](https://github.com/doctor-school/ds-platform/pull/818) [`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat: [#770](https://github.com/doctor-school/ds-platform/issues/770) account profile v1 — `GET /v1/me/profile` (EARS-27: session-scoped self-read of `{email, emailVerified, phone, phoneVerified, displayName}`, nullable-and-present wire shape) + the real `/account` profile surface (EARS-28: canvas «Разделы» render — avatar initials + inline display-name edit, email row with verified badge, read-only phone with explicit empty state, password-reset handoff, «Мои события» link, sign-out; raw session claims removed from the DOM)

### Patch Changes

- Updated dependencies [[`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344)]:
  - @ds/schemas@1.3.0
  - @ds/design-system@1.2.1

## 0.12.0

### Minor Changes

- [#807](https://github.com/doctor-school/ds-platform/pull/807) [`e51330a`](https://github.com/doctor-school/ds-platform/commit/e51330a7b72920589fcac3a3a1ea8203fc8559ef) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Facade re-point ([#769](https://github.com/doctor-school/ds-platform/issues/769)): the portal front door `/` now forwards to the real public
  upcoming-broadcasts listing (`/webinars`) instead of the 003-era «Каркас приложения»
  scaffold card, and the default post-login landing (no `returnTo`) is «Мои события»
  (`/account/events`) instead of the `/account` session dump. The guard-validated
  `?returnTo=/webinars/:slug` registration-resume path is unchanged.

### Patch Changes

- [#781](https://github.com/doctor-school/ds-platform/pull/781) [`325fef7`](https://github.com/doctor-school/ds-platform/commit/325fef762d4f36db282d2d6d07905145584673f8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Room-header AA contrast ([#713](https://github.com/doctor-school/ds-platform/issues/713)): the live presence count and the desktop exit-link label in the webinar-room header are now plain `text-header-foreground` (white) rendered directly on the `bg-header` band, matching the canvas layout with no plate. The AA fix is delivered by deepening the shared `header` band to blue.700 (white = 8.14:1, genuine WCAG-AA in both themes) — the earlier `primary-surface` plate treatment is reverted. The room-route axe e2e scan now includes the `.bg-header` band (no longer excluded).

- Updated dependencies [[`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb), [`325fef7`](https://github.com/doctor-school/ds-platform/commit/325fef762d4f36db282d2d6d07905145584673f8)]:
  - @ds/schemas@1.2.0
  - @ds/design-system@1.2.0

## 0.11.0

### Minor Changes

- [#747](https://github.com/doctor-school/ds-platform/pull/747) [`3dd3039`](https://github.com/doctor-school/ds-platform/commit/3dd303994ae9f7b439bd85282938940fbde36ab4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Portal-wide light/dark theming (006 EARS-12/13, [#702](https://github.com/doctor-school/ds-platform/issues/702)): the theme is the `.dark` class on `<html>` resolved from the `ds-theme` localStorage choice → system `prefers-color-scheme` (an explicit choice always wins, and is followed live while none is stored), applied before first paint by an inline FOUC-guard script in the root layout; the webinar-room header gains the portal's only visible theme toggle — the canvas 44×44 icon-button (`aria-pressed`, glyph ☾ light / ☀ dark, `header-hairline` border) — which flips the theme live and persists the choice; the portal axe e2e suites now sweep both themes.

### Patch Changes

- Updated dependencies [[`3dd3039`](https://github.com/doctor-school/ds-platform/commit/3dd303994ae9f7b439bd85282938940fbde36ab4)]:
  - @ds/design-system@1.1.0

## 0.10.0

### Minor Changes

- [#703](https://github.com/doctor-school/ds-platform/pull/703) [`29ae731`](https://github.com/doctor-school/ds-platform/commit/29ae731096a929745d64800e97d059bded702605) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 [#690](https://github.com/doctor-school/ds-platform/issues/690) — realize deferred webinar-room header canvas elements (live presence count + live-duration)

  Realizes two of the four canvas header elements [#584](https://github.com/doctor-school/ds-platform/issues/584) deferred as tracked
  decision-debt, each now backed by real data (no faked/hardcoded values):

  - **Live presence count** («N врачей в комнате») — a server-side aggregate over
    the existing append-only `presence_beats`: the count of distinct doctors with a
    beat inside the freshness window (2 × the heartbeat cadence N). It rides the
    EARS-1 `RoomConfig` grant (initial value) and every heartbeat ack (live
    refresh), and the portal header renders it desktop-only per the canvas. An
    integer aggregate only — never per-doctor identity or the roster (EARS-8).
  - **Live-duration «· N мин»** on the live pill — counted from the event's actual
    go-live instant. Adds a nullable `events.live_at` column stamped once by 007
    `OpenRoom` (the `published → live` transition); the grant exposes it and the
    room counts elapsed minutes from it, never the scheduled `startsAt`. A legacy
    `live` row with no `live_at` renders the pill with no suffix (truthful).

  Additive schema growth (`RoomConfig.liveAt` + `RoomConfig.presenceCount`,
  `PresenceHeartbeatAck.presenceCount`) and one additive migration
  (`events.live_at`). The theme toggle (re-deferred to [#702](https://github.com/doctor-school/ds-platform/issues/702), dark theme with it)
  and the doctor avatar (no server-side display name exists — re-deferred) remain
  canvas omissions, never dead affordances.

- [#704](https://github.com/doctor-school/ds-platform/pull/704) [`54e425d`](https://github.com/doctor-school/ds-platform/commit/54e425dda80c41de342e87c3b405bc7c1606197f) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(webinars): 006 EARS-6 — «мои события» room-entry CTA + WebinarCard nested-anchor resolution ([#689](https://github.com/doctor-school/ds-platform/issues/689))

  A registered doctor could enter a live webinar room from the event page ([#584](https://github.com/doctor-school/ds-platform/issues/584)) but
  not from «мои события», where each event renders as a `WebinarCard`. The card was a
  whole-card `<a>`, so a room-entry CTA could not be added without nesting interactive
  content inside an anchor.

  - `@ds/design-system`: `WebinarCard` now matches its canvas — the root is a
    container and the title is a stretched link (`::after` overlay), so the whole card
    still opens its event page while an optional secondary action fits alongside with
    no nested anchor. Two additive props (`ctaHref`, `ctaLabel`) render a room-entry
    button (`Button`, filled primary) as a sibling with its own stacking context;
    omitting them keeps the listing card rendering as a single link. **BREAKING:**
    `WebinarCard`'s root element changes `<a>` → `<div>`, its forwarded ref type
    changes `HTMLAnchorElement` → `HTMLDivElement`, and its props base changes
    `ComponentPropsWithoutRef<"a">` → `ComponentPropsWithoutRef<"div">` (anchor-only
    props such as `target`/`rel` are no longer accepted on the card root).
  - `@ds/portal`: `/account/events` renders the «Войти в эфир» room-entry CTA on a
    registered + `live` event, routing to `/webinars/:slug/room` via the hardened
    `resolveRoomEntryHref`; copy reuses the `webinar.registered.live.cta` catalog key.

### Patch Changes

- Updated dependencies [[`29ae731`](https://github.com/doctor-school/ds-platform/commit/29ae731096a929745d64800e97d059bded702605), [`54e425d`](https://github.com/doctor-school/ds-platform/commit/54e425dda80c41de342e87c3b405bc7c1606197f)]:
  - @ds/schemas@1.1.0
  - @ds/design-system@1.0.0

## 0.9.1

### Patch Changes

- [#697](https://github.com/doctor-school/ds-platform/pull/697) [`2e8e20c`](https://github.com/doctor-school/ds-platform/commit/2e8e20c5c4c2f9d490d814d40adae679179b1b08) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(auth): redirect authenticated sessions away from auth surfaces to their destination ([#675](https://github.com/doctor-school/ds-platform/issues/675))

  An already-authenticated visitor could still open the portal auth surfaces
  (`/login`, `/register`, `/reset`, `/verify`) and the admin `/login`, and re-walk
  the whole register→verify→login flow. Now an authenticated visitor hitting any of
  those surfaces is redirected to their destination (portal → `/account`, admin →
  the `events` root) with no auth form rendered: the portal wires a single session
  guard into the shared `<AuthShell>`, and the admin wraps its login form in Refine's
  `<Authenticated>`.

## 0.9.0

### Minor Changes

- [#629](https://github.com/doctor-school/ds-platform/pull/629) [`f27ecbf`](https://github.com/doctor-school/ds-platform/commit/f27ecbf5cf35ab6b4d8bc853086886c5ee8b8642) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-3 — single «Участвовать» CTA + event-context handoff to 005/003

  The public event page (`/webinars/:slug`) now carries exactly **one** primary
  «Участвовать» CTA that routes the visitor into the registration flow (feature 005) through auth (feature 003), carrying the event context so it survives the
  round-trip (feature 004, EARS-3; realizes US-3).

  - `@ds/portal` — the CTA is the adopted `@ds/design-system` `Button` (filled
    blue.700 primary action, [#270](https://github.com/doctor-school/ds-platform/issues/270)) linking to a same-origin registration href
    (`lib/registration-handoff`): `/register?returnTo=/webinars/:slug`. The event
    context rides as a **safe, same-origin** `returnTo` (no PII, no credential, no
    open-redirect — the slug is escaped and always anchored under `/webinars/`),
    matching the intent contract 005's design pins (§3.2). The CTA is present for a
    participable event (`published` / `live`) and **absent** for `ended` (never a
    dead link, EARS-3 invariant). Copy resolves through the 003 message catalog
    (EARS-13); DS tokens only (EARS-14).

  004 owns the CTA and the context handoff only — the registration mechanics and
  the guest→auth→registered round-trip are owned by 005/003 (a tracked seam, parent
  [#549](https://github.com/doctor-school/ds-platform/issues/549); the handoff target is stubbed in 004's E2E). The full per-state affordance
  swap (badge / time plate / room-routing / footer band) is EARS-4; the archived
  notice EARS-5.

- [#635](https://github.com/doctor-school/ds-platform/pull/635) [`774f018`](https://github.com/doctor-school/ds-platform/commit/774f01864032e0f95d5f11d56ec7e784ebc8d70a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-4 — event-page lifecycle render swap (upcoming/live/ended)

  The public event page (`/webinars/:slug`) now reflects the event's current
  lifecycle from the single `EventLifecycleState`, swapping the hero badge, the
  status-card time plate, the CTA affordance, and the footer band per the canvas
  `status` enum — never a signal that contradicts the machine (feature 004,
  EARS-4; realizes US-6).

  - `@ds/design-system` — new `WebinarStatusCard` primitive: the pulled-up
    «статус-карточка» from `webinar-page.dc.html`, reusing the webinar-card
    time-plate geometry (desktop `196px 1fr` grid, 2px border, `6px 6px 0` cast,
    56px time) with a head/sub signal and a single primary-CTA **slot**. Off-scale
    geometry lives in the DS SoT; tokens only, both themes; the `ended` render
    passes no CTA (no dead link). Registered in the showcase `/primitives` route
    (unit-as-subject) so the `playwright-axe` gate scans it — WCAG AA in both themes.
  - `@ds/portal` — `/webinars/:slug` composes the status card + footer band and
    drives the per-state swap via the pure `lib/event-lifecycle` mapping:
    **upcoming** (`published`) → «Участвовать» into the registration handoff
    (EARS-3); **live** → a «В эфире» signal + «Участвовать» routing TOWARD the
    room (feature 006, `buildRoomHref` → `/webinars/:slug/room`; 004 asserts the
    route, not the room); **ended** → the ended affordance with NO participation
    CTA and no footer band. The single primary «Участвовать» CTA is preserved
    (EARS-3 invariant); the footer band carries a distinct verb («Записаться» /
    «Смотреть эфир»). МСК time (EARS-12), catalog copy (EARS-13), DS tokens
    (EARS-14). Archived is the sibling EARS-5 notice — not built here.

  004 asserts the live-state routing target only — the webinar room and its
  server-side join gating are feature 006 (a tracked seam, parent [#549](https://github.com/doctor-school/ds-platform/issues/549), design §8).

- [#638](https://github.com/doctor-school/ds-platform/pull/638) [`51d7e66`](https://github.com/doctor-school/ds-platform/commit/51d7e6673d52c765f6c2886a7aeea3c30faafce5) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-5 — archived direct-link public «в архиве» notice (no CTA)

  A previously-distributed direct link to an event that has since been `archived`
  now degrades gracefully in place instead of dead-ending (feature 004, EARS-5;
  realizes US-6, US-5; owner decision, variant «а»).

  - `@ds/portal` — the public event page (`/webinars/:slug`) renders the archived
    «мероприятие в архиве» notice as the **fourth** render mode on the same
    `WebinarStatusCard` shell (beyond the canvas's `upcoming | live | ended`): a
    plain text notice replaces the status card's CTA column — **no** participation
    CTA, **no** dead link, **no** new geometry (design §5.1). The hero badge reads
    «В архиве» and the footer conversion band is absent. All copy resolves through
    the 003 message catalog (`statusCard.archived.*`, EARS-13); DS tokens only, the
    notice using the card-safe `text-primary-action` (blue.700) on `bg-card`
    (the [#270](https://github.com/doctor-school/ds-platform/issues/270) precedent), never `text-primary` (EARS-14).

  The API side is unchanged: `GET /v1/public/events/:idOrSlug` already resolves an
  `archived` event to a `200 PublicEventPage {state: archived}` (never a 404, never
  a redirect) — the archived-link contract is now pinned by a dedicated Vitest e2e
  (`archived.e2e-spec.ts`) and driven end-to-end on the live stand by the portal
  Playwright coverage. Event authoring / lifecycle transitions remain feature 007
  (a tracked seam, parent [#549](https://github.com/doctor-school/ds-platform/issues/549); archived events are seeded until 007 lands).

- [#619](https://github.com/doctor-school/ds-platform/pull/619) [`67b3da5`](https://github.com/doctor-school/ds-platform/commit/67b3da505dcfc35fac2b7ba7dd13e6d8d0bcec1e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-8 — full webinar-card listing unit + event-page link

  Replaces the wave-1 minimal listing card with the full `webinar-card.dc.html`
  unit and links each card to its event page (feature 004, EARS-8; carries
  EARS-12/13/14 on the card).

  - `@ds/design-system` — new `WebinarCard` listing primitive
    (`@ds/design-system/webinar-card`): the tinted 196px time plate (56px display
    time, explicit МСК label, day·weekday sub-label), school kicker, title,
    specialty chips, and speakers, rendered as a single block-level link. Off-scale
    canvas geometry lives in the design-system SoT (the app-scoped arbitrary-value +
    rhythm gates forbid it in `apps/*`); colour + type flow through tokens, both
    themes, desktop grid / mobile flat full-bleed per the canvas.
  - `@ds/portal` — the `/webinars` listing now renders each card as the `WebinarCard`
    unit (МСК times, no local drift; RU copy via the message catalog), each linking
    to `/webinars/:slug`.

- [#646](https://github.com/doctor-school/ds-platform/pull/646) [`1547fa4`](https://github.com/doctor-school/ds-platform/commit/1547fa4afa1ffcf84290e28a9b2eef368743763c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-2 — guest-through-auth completion carrying event context (003 round-trip)

  A guest activating «Участвовать» is now carried through the shipped 003
  login/signup flow with the **event context** and comes out **registered for that
  same event**, landing back on that event page — no re-search, no second
  «Участвовать» tap (feature 005, EARS-2; realizes US-2). This retires the legacy
  "postponed registration" parking mechanism: there is **no** server-side pending
  record — the intent lives only in the round-trip and the real `RegisterForEvent`
  (EARS-1) fires once, after the session exists.

  - `@ds/schemas` (additive) — `RegistrationIntent` / `RegistrationIntentSchema`
    (strict: the intent carries the event slug + a same-origin
    `returnTo=/webinars/:slug` only — **never** PII or a credential; any extra
    field is rejected) and the `parseReturnTarget` / `isSafeReturnTarget`
    open-redirect guard: a cross-origin, protocol-relative, backslash,
    multi-segment, traversal, or percent-encoded-separator return target resolves
    to `null`, and a safe one reconstructs the canonical `/webinars/<slug>` from
    the validated slug.
  - `@ds/portal` — the returnTo survives every hop of the auth round-trip
    (`/register → /verify`, the `/verify → /login` fallback, and the cross links
    between the auth pages) via the guard-cleaning `withReturnTarget`; on auth
    success — password login, OTP login, or the post-verify auto-login replay —
    `completeReturnTarget` fires the same `RegisterForEvent` through the
    same-origin BFF path (`lib/registration-client`) and lands the doctor on the
    event page registered (best-effort: a transient register failure still lands
    on the event page, where the per-user state read / idempotent retry recovers).
    Without a carried context the shipped `/account` landing is unchanged; a
    hostile returnTo is dropped at every hop and never navigated to.

  The live browser E2E for the full guest journey is batched at the 005
  portal-integration slice ([#574](https://github.com/doctor-school/ds-platform/issues/574)).

- [#647](https://github.com/doctor-school/ds-platform/pull/647) [`4b7ef74`](https://github.com/doctor-school/ds-platform/commit/4b7ef743f3be8f39fd5807ccb70242b18adead19) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-4 — per-user EventRegistrationState on the event page (no public-page contamination)

  The webinar event page now reflects the **authenticated** doctor's true
  registration state (feature 005, EARS-4; realizes US-3). A registered doctor sees
  a «вы записаны» confirmation + a join-signpost placeholder **replacing** the
  register CTA — never the «Участвовать» CTA as if unregistered; an unregistered
  doctor (and a guest) sees the shipped 004 register CTA unchanged.

  - `@ds/portal` — the SSR `/webinars/:slug` route composes the per-user state onto
    the 004 page via a **separate authenticated read** (`lib/registration-state` →
    `GET /v1/events/:idOrSlug/registration`), forwarding the request's session
    cookie **and** its fingerprint surface (`user-agent` + `accept-language`, the
    ADR-0001 §6 session binding) so the api resolves the `__Host-` session
    server-side. It is `cache: "no-store"` and never folded into the public
    `GetPublicEventPage` projection or its shared data cache — 004's public page
    stays byte-for-byte content-identical for guest and principal (a guest never
    issues the read). The registered swap replaces only the `register` CTA
    (upcoming), suppressing the footer «Записаться» band too; the `live` room route
    and `ended`/`archived` renders are untouched (the registered `live` onward path
    is EARS-5, [#569](https://github.com/doctor-school/ds-platform/issues/569)).

  The full join-signposting content is EARS-5 ([#569](https://github.com/doctor-school/ds-platform/issues/569)); the live browser E2E for the
  end-to-end registered journey is batched at the 005 portal-integration slice
  ([#574](https://github.com/doctor-school/ds-platform/issues/574)). Verified live on the dev stand (registered doctor: confirmation + no
  register CTA; guest: 004 register CTA + public page uncontaminated).

- [#684](https://github.com/doctor-school/ds-platform/pull/684) [`59bbc2e`](https://github.com/doctor-school/ds-platform/commit/59bbc2ed5ff990402c97f755b230a03696c84ff3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-3 — live chat over Centrifugo (gated read + real-time post)

  Where the room is open, a gated doctor reads the live chat and posts messages that
  fan out to every participant in real time without a reload, over the room channel
  keyed by event id (feature 006, EARS-3; realizes US-2). Chat rides Centrifugo,
  already in the stack — 006 adds a `room:event:<id>` channel + a gate-scoped,
  subscribe-only connection token, not a new transport.

  - `@ds/schemas` — the room DTOs grow additively: `RoomConfig.chat`
    (`{ url, token, channel, selfTag } | null`, the subscribe-only Centrifugo
    credential), `PostChatMessageRequest` (`{ text }`, validated by the
    `ChatMessageTextSchema` SSOT — trimmed, non-empty, ≤2000), the published
    `RoomChatMessage` (`{ id, authorTag, text, at }` — PII-free), and
    `PostChatMessageAck`.
  - `@ds/api` — `POST /v1/events/:idOrSlug/chat` (`PostChatMessage`), behind the
    **same** admission gate as EARS-1 (`authenticated ∧ registered ∧ live`): the
    backend authorizes, then publishes to Centrifugo over the HTTP API — the **only**
    publish path. The `RoomConfig` grant carries a connection JWT whose `channels`
    claim is gate-scoped to exactly the caller's room channel and grants **no**
    publish capability, so a client can never publish directly. A guest (401),
    unregistered (403), or non-`live` (409) caller publishes nothing (EARS-8); a
    Centrifugo outage is a 503. Author identity is a non-reversible, non-PII tag
    (`authorTag`), never the roster identity. Classified `authenticated` /
    `doctor_guest` / `policy` in the endpoint-authz matrix. Config (`CENTRIFUGO_*`)
    is read from env; unconfigured ⇒ `chat: null` (fail-closed).
  - `@ds/portal` — the room's chat aside is now live: it subscribes over Centrifugo
    (`centrifuge`, MIT) and renders others' messages in real time without a reload,
    and the composer posts through the gated command. The composer enforces the same
    `ChatMessageTextSchema` reject rule as the server (empty / whitespace-only stays
    unsendable). All copy resolves through the typed message catalog (EARS-10); built
    from `@ds/design-system` tokens (EARS-11).

  Room-close refusal of posts (EARS-7, [#583](https://github.com/doctor-school/ds-platform/issues/583)) and the full both-breakpoints × both-
  themes fidelity + Stage-B live confirmation ([#584](https://github.com/doctor-school/ds-platform/issues/584)) are tracked separately.

- [#683](https://github.com/doctor-school/ds-platform/pull/683) [`f20f1da`](https://github.com/doctor-school/ds-platform/commit/f20f1da596fce75b03c6696b968e52f95566934c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-4 — server-authoritative heartbeat presence capture (append-only)

  While a gated doctor is in a live room with the tab visible, the client posts an
  authenticated heartbeat every N seconds and the backend appends each accepted
  beat to a durable append-only Postgres table — the durable basis for the
  per-doctor sponsor minutes (feature 006, EARS-4; realizes US-3).

  - `@ds/schemas` — new `PresenceHeartbeatAckSchema` (`{ eventId, beatAt }`): the
    server-authoritative ack of one accepted beat. `beatAt` is the server-stamped
    instant the row was appended, never a client-supplied count/timestamp — a
    client cannot inflate its own presence (requirements Constraints).
  - `@ds/db` — new append-only `presence_beats` table `(id, user_id, event_id,
beat_at)` (ADR-0003 §3). Immutable rows (no mutable column → nothing to update
    in place); `beat_at` defaults to the server clock; a composite
    `(event_id, user_id, beat_at)` index serves the EARS-5 derivation read.
  - `@ds/api` — `POST /v1/events/:idOrSlug/heartbeat` → `RecordPresenceHeartbeat`,
    behind the **same** server-side gate as the EARS-1 `RoomConfig` read (one gate,
    reused): a guest (401), an unregistered doctor (403), and a non-`live` / `ended`
    event (409) are each refused server-side and append **nothing** (EARS-8). On
    admission it appends exactly one row and returns the ack. Classified
    `authenticated` / `doctor_guest` / `policy` in the endpoint-authz matrix.
  - `@ds/portal` — the room mounts a visibility-gated `PresenceHeartbeat` loop (no
    doctor-facing affordance): it POSTs a beat every N seconds — N from
    `RoomConfig.heartbeatIntervalSeconds` (server config, default 60 s) — while the
    tab is the visible, active tab (Page Visibility API); a backgrounded tab
    (`document.hidden`) emits none, and the loop resumes on re-visibility.

  Cadence N is server config, parameterized downstream: the per-doctor
  minute derivation + concurrent-tab coalescing is EARS-5 ([#581](https://github.com/doctor-school/ds-platform/issues/581)), room-close
  refusal is EARS-7 ([#583](https://github.com/doctor-school/ds-platform/issues/583)), chat is EARS-3 ([#579](https://github.com/doctor-school/ds-platform/issues/579)). The 006↔007 lifecycle seam
  (live/ended driven by seeded events until 007 lands) is unchanged.

- [#685](https://github.com/doctor-school/ds-platform/pull/685) [`46f6b9f`](https://github.com/doctor-school/ds-platform/commit/46f6b9fbfd5c2a31bbb22586aa386358383abf77) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-6 — denied-access routing (auth/register/not-live front door)

  When a caller reaches `/webinars/:slug/room` but is not admissible, the room now
  routes them TRUTHFULLY per the server-side gate outcome (EARS-1) — never a soft
  wall over a rendered player (feature 006, EARS-6; realizes US-1, US-5). The room
  adds no auth or registration primitive; it consumes the shipped 003 auth and 005
  register flows and makes each denied branch a complete, guided front door.

  - Unauthenticated → through the 003 auth flow carrying a `returnTo` back to the
    ROOM url, so on login (or signup) the gate RE-RUNS on return and admits a
    registered doctor to a live room. New `lib/room-return.ts` guard parses the
    room-return target (`/webinars/<slug>/room`) reusing the hardened `@ds/schemas`
    slug validation (open-redirect-safe); `completeReturnTarget` routes a room
    return to the room and fires NO registration (a visitor is never silently joined
    to the roster), and `withReturnTarget` carries it through the signup hop.
  - Authenticated-but-unregistered → guided to the 005 register front door on the
    event page (`?from=room`), which surfaces catalog-sourced access-branch guidance
    (EARS-10) above the one-tap register CTA; on register the doctor re-enters the
    room, admitted.
  - Event not `live` → the truthful 004 lifecycle state on the event page, with no
    watchable room and no register banner.

  All copy resolves through the typed message catalog (new `room.accessGuidance`,
  EARS-10). Verified end-to-end on the live stand
  (`e2e/room-access-branches.spec.ts`, all three branches) — no branch renders the
  player, chat, or room composition. The 006↔007 lifecycle seam (live/ended driven
  by seeded events until 007 lands) is unchanged; Stage-B canvas fidelity is batched
  at [#584](https://github.com/doctor-school/ds-platform/issues/584).

- [#679](https://github.com/doctor-school/ds-platform/pull/679) [`ae1465d`](https://github.com/doctor-school/ds-platform/commit/ae1465d24c3aa4e9cabe13e8f5036bebb3852180) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 004 portal integration + browser-E2E slice ([#559](https://github.com/doctor-school/ds-platform/issues/559)). User-facing: the `/webinars`
  listing card of an event the viewer is REGISTERED for now carries the canvas
  `registered` variant's «Вы записаны» marker (owner decision on the [#559](https://github.com/doctor-school/ds-platform/issues/559) Stage-B
  gate) — composed in the portal layer from the viewer's own 005 `MyEvents` read,
  so the public listing projection stays publish-safe (EARS-10) and a guest's
  render is unchanged. `WebinarCard` gains the additive `registered` /
  `registeredLabel` props (AA remap per the [#270](https://github.com/doctor-school/ds-platform/issues/270) precedent: ink label + a
  success-hued decorative ✓ — canvas green.500 is sub-AA on the light card).
  Ships with the 004 all-states DISCOVERY journey translated to `playwright-bdd`
  (sponsor direct link → read page → open listing → click card → back, across
  upcoming/live/ended/archived — the requirements Verification `all` row), the
  surface-wide cross-cutting assertions (EARS-11 empty-state on the real route,
  EARS-12 МСК no-drift under a non-Moscow browser timezone, EARS-13
  no-hardcoded-strings), and a guest-only axe-core WCAG 2 A/AA scan of the public
  webinar surfaces.

- [#648](https://github.com/doctor-school/ds-platform/pull/648) [`d1f8e15`](https://github.com/doctor-school/ds-platform/commit/d1f8e154938b8a66d95fbb55353bb22ce4476b62) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 005 EARS-5 — registered-doctor join signposting on the webinar event page. For a
  registered doctor the page now signposts how/when they join, layered on the 004
  lifecycle CTA: `upcoming` shows the broadcast start (date/time МСК) + a «вы
  записаны» confirmation replacing the register CTA; `live` shows the confirmation

  - an obvious onward path to the room (feature 006 route). Built to the vendored
    `webinar-page.dc.html` registered states from `@ds/design-system` tokens (EARS-13),
    with МСК presentation and no viewer-local drift (EARS-11).

- [#649](https://github.com/doctor-school/ds-platform/pull/649) [`bac9f1e`](https://github.com/doctor-school/ds-platform/commit/bac9f1eaceca4fb20da17b4e1bdba5fe8effdd66) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 005 EARS-6 — «мои события» Предстоящие tab + `MyEvents` read model

  The portal account gains a «мои события» surface (the **Предстоящие** tab of
  `my-events.dc.html`) listing the authenticated doctor's registered **upcoming**
  events, closing the legacy "registered but can't find it" gap (feature 005,
  EARS-6; realizes US-4). Carries the EARS-10 (authz), EARS-11 (МСК), EARS-13
  (canvas fidelity) cross-cutting ACs.

  - `@ds/schemas` — the `MyEventItem` / `MyEvents` DTOs: the caller's registered
    upcoming events, each `{ eventId, slug, title, school, startsAt, state }`,
    `state` constrained to the `published`/`live` registrable set.
  - `@ds/api` — the `MyEvents` read model: `GET /v1/me/events`,
    **`doctor_guest`-authenticated** (EARS-10), returning the caller's registered
    `published`/`live` events (future or currently airing, `starts_at ≥ now −
AIR_WINDOW_MS` — mirroring the 004 upcoming listing), ordered **nearest
    `startsAt` first**. Returns ONLY the caller's own registrations; `ended`/
    `archived` and other doctors' registrations are absent. An empty result is a
    valid `[]`. The endpoint-authz matrix carries the new classified route.
  - `@ds/portal` — the «мои события» page at `/account/events` (SSR, authenticated;
    a guest is redirected to login). Day-grouped, nearest-first, each row the
    reused `@ds/design-system` `WebinarCard` unit (built to the canvas geometry:
    2px borders, `6px 6px 0` shadow, time plate) linking to `/webinars/:slug`, with
    date/time in `Europe/Moscow` labeled **МСК** (EARS-11) and the canvas
    empty-state when the list is empty. Copy resolves through the message catalog
    (EARS-12); DS tokens only (EARS-13). Wave-1 cut: the Записи / Сертификаты tabs
    and the specialty filter are a named deferral — not built.

- [#673](https://github.com/doctor-school/ds-platform/pull/673) [`8d1c9bb`](https://github.com/doctor-school/ds-platform/commit/8d1c9bb0f488e524b08f3ff504be50b3a9b99e76) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 005 portal integration + browser-E2E slice ([#574](https://github.com/doctor-school/ds-platform/issues/574)). User-facing: a logged-in
  doctor now registers for a webinar in ONE action on the event page — the
  «Участвовать» CTA becomes a one-tap command that records the registration and
  swaps the page to the registered state, instead of routing an already-authenticated
  doctor through the guest signup flow (EARS-1). Ships with the all-states
  registration JOURNEY translated to `playwright-bdd` (guest → «Участвовать» → 003
  auth → returns registered → «мои события» → back to the event page, plus logged-in
  one-tap and ended/archived gating — the requirements Verification `all` row), the
  surface-wide cross-cutting assertions (EARS-10 `doctor_guest` authz, EARS-11 МСК
  no-drift under a non-Moscow browser timezone, EARS-12 no-hardcoded-strings), and an
  axe-core WCAG 2 A/AA scan of the touched webinar surfaces.

- [#628](https://github.com/doctor-school/ds-platform/pull/628) [`6bdb1c3`](https://github.com/doctor-school/ds-platform/commit/6bdb1c308506b5a5394cfa38fb6c7fd600a4e87a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-2 — event-page content set from PublicEventPage projection

  Builds the public event page's complete decision set (feature 004, EARS-2;
  carries EARS-12/13/14 on the surface), laid out to `webinar-page.dc.html`.

  - `@ds/design-system` — new `WebinarPageContent` primitive
    (`@ds/design-system/webinar-page-content`): the two-column event-page body —
    the «О чём эфир» description, the downloadable program-PDF affordance, the
    sponsor plate (backing partners), and the «Спикеры» aside cards (64px tint
    initials square, name + credentials). The program affordance and the sponsor
    plate are omitted (not null-broken) when absent. Off-scale canvas geometry (the
    `1fr 380px` split, the 64px avatar) lives in the design-system SoT — the
    app-scoped arbitrary-value gate forbids it in `apps/*`; colour + type flow
    through tokens, both themes, desktop grid / mobile stacked per the canvas.
  - `@ds/portal` — the `/webinars/:slug` event page now renders the target
    specialty chips in the poster header and the full content set below it via
    `WebinarPageContent` (МСК times, no local drift; RU copy via the 003 message
    catalog).

- [#606](https://github.com/doctor-school/ds-platform/pull/606) [`c959008`](https://github.com/doctor-school/ds-platform/commit/c9590083f62c08b274311dbfe101ba914425d873) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-1 — public event-page read endpoint + portal SSR shell

  Adds the read side of the Webinars public surface: `GET /v1/public/events/:idOrSlug`
  (NestJS, classified **public** in the endpoint-authz matrix — no auth, no cookie)
  returning the publish-safe `PublicEventPage` projection (an allow-list — no
  operator/commercial fields, no registrant PII), resolving by slug or id;
  `published`/`live`/`ended`/`archived` → 200, `draft`/unknown → 404. Plus the
  server-rendered portal `/webinars/:slug` route shell (complete HTML for an
  unauthenticated recipient, no client soft-wall) and a shared МСК time formatter.
  Read against seeded fixture events until feature 007 delivers authoring/transitions
  (tracked seam, parent [#549](https://github.com/doctor-school/ds-platform/issues/549)). Full content layout, CTA, listing, and lifecycle swap
  are sibling handlers.

- [#613](https://github.com/doctor-school/ds-platform/pull/613) [`9d5fc7c`](https://github.com/doctor-school/ds-platform/commit/9d5fc7c14cc44a0e4db071329e8581ddc3d5a211) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(events): 004 EARS-7 — upcoming-broadcasts listing endpoint + day-grouped portal route

  Adds the listing side of the Webinars public surface: `GET /v1/public/events?upcoming`
  (NestJS, classified **public** in the endpoint-authz matrix — no auth, no cookie)
  returning the thin publish-safe `UpcomingBroadcastCard[]` projection (an allow-list —
  name-only speakers, no operator/commercial fields, no registrant PII) filtered to
  `published`/`live` events at or after the air-window cutoff, ordered nearest air date
  first; an empty result is a valid `200 []` (EARS-11). Plus the server-rendered portal
  `/webinars` route — a day-grouped nearest-first list built to the §09 canvas rhythm
  (full-bleed day band on mobile, label + rule on desktop) with the canvas empty-state
  when the projection is empty. Wave-1 minimal cut — no facets, week-paging, month view,
  or search. Cards are the minimal shell (time · МСК · live signal · school · title,
  linking to the event page); the full webinar-card choose-set is sibling EARS-8 ([#557](https://github.com/doctor-school/ds-platform/issues/557)).
  Read against seeded fixture events until feature 007 delivers authoring/transitions
  (tracked seam, parent [#549](https://github.com/doctor-school/ds-platform/issues/549)).

### Patch Changes

- [#687](https://github.com/doctor-school/ds-platform/pull/687) [`d57ac0c`](https://github.com/doctor-school/ds-platform/commit/d57ac0c7b609f1ace068c67af2181c54ee1181e2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(room): 006 EARS-7 — room-close stops heartbeat + chat capture

  When the event leaves `live` (the director closes the room, feature 007), the
  system stops accepting heartbeats and chat posts for that event and the room
  degrades to the truthful ended state (feature 006, EARS-7; realizes US-3, US-4).
  This handler adds no new code path — the refusal is the SAME server-side admission
  gate as EARS-1 (`authenticated ∧ registered ∧ live`): once the event leaves `live`
  the `live` condition fails and every room operation is refused server-side. EARS-7
  pins that close semantics as one coherent, verified story.

  - `@ds/api` — the `RoomConfig` grant read, the gated heartbeat, and the gated chat
    post are each refused with a `409` carrying the truthful `ended` state once the
    room closes. A beat/post accepted while the room was open is refused the instant
    it closes, and NO beat or post lands after close (`presence_beats` does not grow).
    Per-doctor presence minutes (EARS-5) are therefore computed over the beats
    captured **while the room was open** — a beat refused after close never exists,
    so it cannot inflate the sponsor minutes. Pinned by the Vitest e2e
    (`apps/api/test/room/room-close.e2e-spec.ts`).
  - `@ds/portal` — the room surface degrades TRUTHFULLY: after close the gate no
    longer issues the grant, so the `not-live` branch routes the doctor to the 004
    ended lifecycle state («Эфир завершён») with no watchable player, no writable
    chat, and no room composition — never a soft wall over a dead room. Verified
    end-to-end on the live stand (`apps/portal/e2e/room-close.spec.ts`).

  The 006↔007 lifecycle seam is unchanged (the live → ended transition is driven by
  seeded events until 007's director controls land, tracked on parent [#576](https://github.com/doctor-school/ds-platform/issues/576));
  Stage-B canvas fidelity is batched at [#584](https://github.com/doctor-school/ds-platform/issues/584).

- Updated dependencies [[`774f018`](https://github.com/doctor-school/ds-platform/commit/774f01864032e0f95d5f11d56ec7e784ebc8d70a), [`70f5e3e`](https://github.com/doctor-school/ds-platform/commit/70f5e3e80c90a1738096c2909165a682dd6ee9c7), [`67b3da5`](https://github.com/doctor-school/ds-platform/commit/67b3da505dcfc35fac2b7ba7dd13e6d8d0bcec1e), [`ce4b05d`](https://github.com/doctor-school/ds-platform/commit/ce4b05dd06d5d0c2ed39e04b87f7cca2d396185b), [`1547fa4`](https://github.com/doctor-school/ds-platform/commit/1547fa4afa1ffcf84290e28a9b2eef368743763c), [`31b97f2`](https://github.com/doctor-school/ds-platform/commit/31b97f246adfad18d56c336a6559234b1a26c26a), [`e3ce9eb`](https://github.com/doctor-school/ds-platform/commit/e3ce9eb7780d283d52e32321e1fc145ec1720981), [`59bbc2e`](https://github.com/doctor-school/ds-platform/commit/59bbc2ed5ff990402c97f755b230a03696c84ff3), [`f20f1da`](https://github.com/doctor-school/ds-platform/commit/f20f1da596fce75b03c6696b968e52f95566934c), [`b46b15a`](https://github.com/doctor-school/ds-platform/commit/b46b15ad2e7b37d0129db0461240979544438c10), [`2993933`](https://github.com/doctor-school/ds-platform/commit/29939330ee4c3e904842e699e512fe632d8deb9f), [`1b80b39`](https://github.com/doctor-school/ds-platform/commit/1b80b39a7e69c490425d96fd0eedab1bb63d24e7), [`c99ba53`](https://github.com/doctor-school/ds-platform/commit/c99ba534eb7b7e3b1816b43baa7b645edec98550), [`074d2e7`](https://github.com/doctor-school/ds-platform/commit/074d2e78c828fe86687c31038ed61e7285e681d9), [`ae1465d`](https://github.com/doctor-school/ds-platform/commit/ae1465d24c3aa4e9cabe13e8f5036bebb3852180), [`bac9f1e`](https://github.com/doctor-school/ds-platform/commit/bac9f1eaceca4fb20da17b4e1bdba5fe8effdd66), [`05f0964`](https://github.com/doctor-school/ds-platform/commit/05f0964d92f288ba58e05364e82ae01076afb9e2), [`da579b0`](https://github.com/doctor-school/ds-platform/commit/da579b0450b90ea48e40c37f5c7051b3e32e6f75), [`6bdb1c3`](https://github.com/doctor-school/ds-platform/commit/6bdb1c308506b5a5394cfa38fb6c7fd600a4e87a), [`c959008`](https://github.com/doctor-school/ds-platform/commit/c9590083f62c08b274311dbfe101ba914425d873), [`9d5fc7c`](https://github.com/doctor-school/ds-platform/commit/9d5fc7c14cc44a0e4db071329e8581ddc3d5a211)]:
  - @ds/design-system@0.8.0
  - @ds/schemas@1.0.0

## 0.8.1

### Patch Changes

- Updated dependencies [[`73dcd7f`](https://github.com/doctor-school/ds-platform/commit/73dcd7f1c9b16d7b008f9e5015fe34531eac66fa)]:
  - @ds/design-system@0.7.0

## 0.8.0

### Minor Changes

- [#540](https://github.com/doctor-school/ds-platform/pull/540) [`6ae9995`](https://github.com/doctor-school/ds-platform/commit/6ae99952fc7a23e506597c8182b3c1b423b47d1b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-skin the `/login` surface to the neo-brutalist language ([#518](https://github.com/doctor-school/ds-platform/issues/518)). The screen now
  composes the already-re-skinned design-system blocks (`AuthCard`, `AuthLayout`,
  `OtpFocusScreen`, `Tabs`, `Button` — [#512](https://github.com/doctor-school/ds-platform/issues/512)/[#517](https://github.com/doctor-school/ds-platform/issues/517)) into the canvas `auth.dc.html`
  composition: the brand panel gains an eyebrow caps-label above a heavier headline +
  sub-copy (the shared `AuthShell` aside, mirrored by the showcase `NeutralAside`), the
  password ⇄ one-time-code segment control and the «Эл. почта | SMS» channel selector
  read in the canvas language and split the row into equal halves. Purely visual — no
  form logic, BFF call, resend cooldown, OTP length (still 8), or behaviour changed.

- [#541](https://github.com/doctor-school/ds-platform/pull/541) [`5d2f1b2`](https://github.com/doctor-school/ds-platform/commit/5d2f1b2fb0251b045f7ffae0733af0f86250d12b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-skin the `/register`, `/verify` and `/reset` surfaces to the neo-brutalist
  language ([#519](https://github.com/doctor-school/ds-platform/issues/519)). Each screen now composes the already-re-skinned design-system blocks
  (`AuthCard`, `AuthLayout`, `OtpFocusScreen`, `Alert`, `Button` — [#512](https://github.com/doctor-school/ds-platform/issues/512)/[#513](https://github.com/doctor-school/ds-platform/issues/513)/[#517](https://github.com/doctor-school/ds-platform/issues/517)) into
  the canvas `auth.dc.html` composition, matching the merged `/login` re-skin ([#518](https://github.com/doctor-school/ds-platform/issues/518)):

  - register: canvas title/description/consent copy.
  - verify: the two co-equal sections gain the canvas eyebrow caps-labels; the accepted
    code shows a «Код принят — входим…» success row (the DS `Alert` success variant)
    while the auto-login replay routes; «Войти» reads as the primary action.
  - reset: the card title tracks the stage («Сброс пароля» → «Новый пароль»), canvas
    code/label copy, and the «← Вернуться ко входу» back link.

  Purely visual — no form logic, BFF call, resend cooldown, OTP length (verify/reset
  still 6), or consent semantics changed.

### Patch Changes

- [#543](https://github.com/doctor-school/ds-platform/pull/543) [`63e72ce`](https://github.com/doctor-school/ds-platform/commit/63e72ce6667e233eb05e3733a73778f31a216298) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the resend-cooldown row overflowing the auth card frame ([#542](https://github.com/doctor-school/ds-platform/issues/542)). The `Button` base carries `whitespace-nowrap`, so the longer verify/reset resend copy («Отправить повторно можно через N с») could neither wrap nor shrink in the `justify-between` row and pushed past the card's right border (owner-reported on /reset). Two changes: (1) the verify + reset resend copy now matches the canvas canonical form the login OTP screen already uses — «Отправить снова» / «Отправить снова · N с»; (2) the resend control on the shared `<OtpFocusScreen>` block and the inline reset/verify rows gains `min-w-0 whitespace-normal text-right` (with `shrink-0` on the neighbouring change-method / start-over control) so the cooldown label wraps instead of overflowing at any width, both themes. Cooldown timing/logic unchanged.

- Updated dependencies [[`2dbd927`](https://github.com/doctor-school/ds-platform/commit/2dbd927442738b81d533492563482da36a811b93), [`63e72ce`](https://github.com/doctor-school/ds-platform/commit/63e72ce6667e233eb05e3733a73778f31a216298), [`8ae9f6f`](https://github.com/doctor-school/ds-platform/commit/8ae9f6f448896e6aca92f24cee2264dc95bbf796), [`2e95bcd`](https://github.com/doctor-school/ds-platform/commit/2e95bcd2892b4fe56895d5561a0980b9aaf75a69), [`42ce21f`](https://github.com/doctor-school/ds-platform/commit/42ce21f6999cea3f784d5d051cb53ce43dbd2031), [`d7327b4`](https://github.com/doctor-school/ds-platform/commit/d7327b440490d50e8e146b6649e6778f18b01cf9), [`3812ebb`](https://github.com/doctor-school/ds-platform/commit/3812ebb910ff24efc7012b3e44cdf0b477f29e53), [`c58320b`](https://github.com/doctor-school/ds-platform/commit/c58320b97509472f15fbc5e73406ba758855e76d)]:
  - @ds/design-system@0.6.0

## 0.7.2

### Patch Changes

- Updated dependencies [[`88514b6`](https://github.com/doctor-school/ds-platform/commit/88514b60c93d47805dcc71539e84f89f8b2edda8)]:
  - @ds/schemas@0.9.0
  - @ds/design-system@0.5.2

## 0.7.1

### Patch Changes

- Updated dependencies [[`18de7ef`](https://github.com/doctor-school/ds-platform/commit/18de7ef2a24bbbe5b69d73ca6a1837e864d53437)]:
  - @ds/design-system@0.5.1

## 0.7.0

### Minor Changes

- [#398](https://github.com/doctor-school/ds-platform/pull/398) [`25a22ca`](https://github.com/doctor-school/ds-platform/commit/25a22ca0b71961ce599cf8b891595d59736c87a6) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Submit/pending progress visualization across the auth surfaces ([#337](https://github.com/doctor-school/ds-platform/issues/337)). Every async
  submit now drives the shared `Button.loading` affordance from its in-flight flag
  (`loading={isSubmitting}`) instead of a static `disabled={isSubmitting}` — a
  determinate spinner + `aria-busy` + disabled-while-loading, so the surface reads as
  "working" instead of appearing to hang (the [#333](https://github.com/doctor-school/ds-platform/issues/333) Stage-B owner finding). Covers
  login (password + OTP request), register, reset (request + complete), verify, and the
  shared `<OtpFocusScreen>` block. `prefers-reduced-motion` and the double-submit guard
  are already satisfied by `Button.loading`. The standard is documented in ADR-0013 §7
  and enforced by a new `submit-pending` lint guard (WARN).

### Patch Changes

- Updated dependencies [[`25a22ca`](https://github.com/doctor-school/ds-platform/commit/25a22ca0b71961ce599cf8b891595d59736c87a6)]:
  - @ds/design-system@0.5.0

## 0.6.0

### Minor Changes

- [#336](https://github.com/doctor-school/ds-platform/pull/336) [`c7fa09f`](https://github.com/doctor-school/ds-platform/commit/c7fa09fc53432c338ec99aed8725d110a670cba3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-do the slice-B form error/hint/spacing/tab standard from live owner-reviewed defects ([#333](https://github.com/doctor-school/ds-platform/issues/333)), with research-backed **rendered options** picked by the product owner (Stage A).

  - **K-1 — over-spacing → inline message.** `FormMessage` no longer reserves a permanent `min-h-5` line under every field (the slice-B blank-line over-spacing); it renders **on demand** — the helper (muted) by default, swapping the error into its place on failure, and **nothing** at rest when there is neither. Error/helper text is `text-xs` (12 px) and **not bold**. Forms space fields with `space-y-4` (16 px) — larger than the in-field gap — so a message reads as belonging to **its** field, not the next one (proximity). Long forms (>3 fields) use an error-summary panel below submit (rule documented; `<FormErrorSummary>` deferred to the first such form).
  - **K-2 — glued tabs on hover → gap track.** `TabsList` gains a `gap-2` track between segments so an inactive segment's hover fill never butts flush against the active one (the slice-B hover-gluing).
  - **K-3 — "red mush" → mark the field.** Invalidity is carried by the input border + a destructive focus ring (`aria-invalid:border-destructive` / `aria-invalid:focus-visible:ring-destructive`) + the message; the **label stays neutral** (no more red label + red helper + red message).
  - Standard updated to match shipped reality: ADR-0013 §7 (Form layout & validation contract; segment-separation [#4](https://github.com/doctor-school/ds-platform/issues/4)) + the design-system README (`Form layout standard` + clickable matrix). Portal auth forms (`/login`, `/register`, `/reset`, `/verify`) adopt `space-y-4`. Live-verified on the dev stand across login (password + OTP), register, and verify.

- [#330](https://github.com/doctor-school/ds-platform/pull/330) [`e909b86`](https://github.com/doctor-school/ds-platform/commit/e909b861843e28dc0fee68e24f96774437bc39ea) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - OTP focus-resend on `/verify` and `/reset` code steps ([#227](https://github.com/doctor-school/ds-platform/issues/227), [#267](https://github.com/doctor-school/ds-platform/issues/267), EARS-24/25).

  - **`/verify`** — the existence-agnostic dual-affordance verify screen (enter the email code AND the co-equal «Войти» / «Сбросить пароль», EARS-24) now offers **resend-with-cooldown** wired to the real `POST /v1/auth/verify/resend` endpoint (EARS-25, [#319](https://github.com/doctor-school/ds-platform/issues/319)). A successful resend re-issues the code, restarts the 30s cooldown, and clears the stale typed code; the layout keeps both co-equal paths (it is NOT collapsed into the single-focus `OtpFocusScreen`). The resend control is hidden on a bare deep-link with no `?email=` destination to target. Auto-submit and the EARS-16 generic outcome are preserved.
  - **`/reset`** — the complete step (code + new password submitted together) gains a **resend-with-cooldown** wired to the existing `requestPasswordReset(identifier)` (no new backend) plus a **«Начать заново»** action that returns to the request step to change the identifier. The code+password-together shape is kept (no auto-submit, intentional).
  - **Bot-protection (EARS-17).** Both resend endpoints are `@BotProtected`, so each resend carries its own captcha token via `BotProtectionField` (renders nothing when no provider is configured — the dev default — so the guard short-circuits to ok). The `/verify` screen, which previously had no bot-protection field, now renders one for its resend.
  - **`@ds/portal`** — new `authClient.resendVerification` BFF helper and a `useResendCooldown` hook factoring the shared resend orchestration (nonce bump + clear-stale-code + error routing + success acknowledgement) across `/login`, `/verify`, `/reset`.
  - **Neutral, enumeration-safe resend confirmation ([#326](https://github.com/doctor-school/ds-platform/issues/326))** — a resend on `/verify` and `/reset` now shows a generic, identical-in-every-case `role="status"` confirmation (it previously re-armed the cooldown but acknowledged nothing — a "dead button"). The "account exists" fact is disclosed out-of-band by email, never on-screen (OWASP Authentication Cheat Sheet + WSTG account-enumeration; Clerk user-enumeration-protection); the confirmation is conditionally phrased and asserts nothing about account existence. UI-only — a resend sends no additional notice email.
  - **`@ds/design-system`** — new exported `useResendCountdown` hook factoring the live resend-cooldown timer; `OtpFocusScreen` now composes it, and the `/reset` inline resend (which can't adopt the whole block) reuses the identical timer instead of duplicating the interval logic.

  **Systemic auth-surface polish (live-review findings — apply to every auth surface, not just slice B):**

  - **`secondary` Button variant** redefined — the borderless light fill read as "disabled"; it now carries a resting border (parity with `outline`), a tonal fill, a brand-ring hover, and a darker active, so a secondary action (login OTP «Отправить код», verify «Войти») reads as clearly enabled/clickable.
  - **Form field layout (no reflow on error)** — `FormMessage` now always renders a reserved one-line slot (`min-h`, `aria-hidden` while empty), so showing/hiding a validation message no longer grows the form; `FormItem` uses a clearer label→control gap so the focus ring never touches the label.
  - **`OtpFocusScreen` resend label** uses `tabular-nums` so the countdown digits don't jitter as the seconds tick (also applied to the `/verify` and `/reset` inline resend labels).
  - **`/reset` complete step** — the «Начать заново» + resend footer is separated from the password field with a top border + spacing (was jammed against the input).

### Patch Changes

- Updated dependencies [[`c7fa09f`](https://github.com/doctor-school/ds-platform/commit/c7fa09fc53432c338ec99aed8725d110a670cba3), [`e909b86`](https://github.com/doctor-school/ds-platform/commit/e909b861843e28dc0fee68e24f96774437bc39ea), [`0c679fa`](https://github.com/doctor-school/ds-platform/commit/0c679faae7a1639341a575638316064c7592cb56)]:
  - @ds/design-system@0.4.0
  - @ds/schemas@0.8.0

## 0.5.1

### Patch Changes

- [#295](https://github.com/doctor-school/ds-platform/pull/295) [`8645614`](https://github.com/doctor-school/ds-platform/commit/8645614d9fe5dc194a65b619cb65ae58641309e4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(266): `OtpFocusScreen` gains a `resendNonce` prop that restarts the resend
  cooldown without a remount. The block previously re-seeded its countdown only
  when `cooldownSeconds` changed, so a resend re-issuing the same duration could
  not restart it — the portal login worked around this by remounting the verify
  form via `key={resendNonce}`. Consumers now bump `resendNonce` instead; the
  portal login drops the remount hack and clears the stale code explicitly on the
  same signal.
- Updated dependencies [[`8645614`](https://github.com/doctor-school/ds-platform/commit/8645614d9fe5dc194a65b619cb65ae58641309e4)]:
  - @ds/design-system@0.3.0

## 0.5.0

### Minor Changes

- [#268](https://github.com/doctor-school/ds-platform/pull/268) [`83ff3fd`](https://github.com/doctor-school/ds-platform/commit/83ff3fd06559a24d73a0a8467a4d2ff6773c6ae0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(237): rebuild the portal auth surfaces on the design system — the reference vertical slice. login / register / verify / reset are re-skinned onto tokens + blocks from `@ds/design-system`, wrapped in the new `AuthLayout` split-screen block (shadcn `login-03`, re-skinned to tokens) with the Doctor School brand applied (Inter, SVG wordmark logo). The brand panel uses the new AA-safe `primary-surface` token (blue.700 `#114D9E`, white 8.14:1) — `primary` (blue.500) only clears AA for large/bold text, so a colour panel carrying normal-weight copy uses `primary-surface` (ADR-0013 §7). Logos ship as SVG (ADR-0013 §8): the clean white variant sits directly on the panel (no `bg-card` chip), and the form-column logo is `lg:hidden` so there is exactly one logo per viewport. Passwordless OTP login now renders the `OtpFocusScreen` block once a code is requested — masked destination + auto-submit + resend-with-cooldown + change-method — closing the [#192](https://github.com/doctor-school/ds-platform/issues/192)/[#196](https://github.com/doctor-school/ds-platform/issues/196)/[#200](https://github.com/doctor-school/ds-platform/issues/200)/[#211](https://github.com/doctor-school/ds-platform/issues/211)/[#212](https://github.com/doctor-school/ds-platform/issues/212)/[#227](https://github.com/doctor-school/ds-platform/issues/227) papercut class. Masked destinations also applied to the verify/reset code steps. App glue (BFF `/v1/auth/*`, EARS-16 generic errors, i18n, auto-submit) is unchanged — only the presentation layer moved onto the system.

### Patch Changes

- [#289](https://github.com/doctor-school/ds-platform/pull/289) [`2253f43`](https://github.com/doctor-school/ds-platform/commit/2253f43a8337e2b64fbeb138784035209007f0ee) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(237): brand panel left / form right — the recorded column-order decision. The `AuthLayout` split-screen shipped with the inherited shadcn `login-03` default (form-left / panel-right), but the [#237](https://github.com/doctor-school/ds-platform/issues/237) settled product-owner decision is brand-panel LEFT, form RIGHT. The form column stays first in source order (a11y — the interactive surface precedes the decorative panel) and is flipped visually on `lg+` via `lg:order-2` (panel `lg:order-1`); the `< lg` single-column layout (panel hidden, form fills) is unchanged.

- Updated dependencies [[`0df9312`](https://github.com/doctor-school/ds-platform/commit/0df9312d3333e81d49039146e4b23c8ca8ac777a), [`2253f43`](https://github.com/doctor-school/ds-platform/commit/2253f43a8337e2b64fbeb138784035209007f0ee), [`83ff3fd`](https://github.com/doctor-school/ds-platform/commit/83ff3fd06559a24d73a0a8467a4d2ff6773c6ae0), [`74508d6`](https://github.com/doctor-school/ds-platform/commit/74508d69d293fb3ca418dee638e4719f2fb7b7e7), [`8b986ff`](https://github.com/doctor-school/ds-platform/commit/8b986ffcad8e39e592c3be5db4c565211c18d185)]:
  - @ds/design-system@0.2.0

## 0.4.0

### Minor Changes

- [#223](https://github.com/doctor-school/ds-platform/pull/223) [`0413ad6`](https://github.com/doctor-school/ds-platform/commit/0413ad67fba93d3a3c10e04e70017ce42aec4319) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Relax password-recovery friction: auto-login after reset + forgiving auth rate-limit ([#221](https://github.com/doctor-school/ds-platform/issues/221), [#222](https://github.com/doctor-school/ds-platform/issues/222), 003 EARS-12/13).

  Two product-owner-approved refinements to feature 003 found in live testing, both
  shipped together.

  **Auto-login after password reset ([#221](https://github.com/doctor-school/ds-platform/issues/221), EARS-12).** Completing a password reset
  no longer drops the user back on `/login`. `POST /v1/auth/password/reset/complete`
  keeps the global force-logout (`revokeAllForSub`) and the `PasswordResetCompleted`
  audit, then mints a **fresh authenticated session** for the subject via the same
  `SessionService.establish` hop login uses — emitting the identical session-created
  `LoginSucceeded` audit row and setting the `__Host-ds_session` cookie. The
  response body stays token-free (`{status:"reset_completed"}`, EARS-8). The IdP
  port's `completePasswordReset` now returns a checked `IdpSession` (the real
  adapter runs a `POST /v2/sessions` password check with the new password; the
  `FakeIdpClient` is no more permissive). The portal `/reset` page routes to
  `/account` on success. A bad/expired code or unknown identifier is unchanged — the
  same generic 400, no session, no existence oracle (EARS-16).

  **Forgiving auth rate-limit ([#222](https://github.com/doctor-school/ds-platform/issues/222), EARS-13, ADR-0001 §7).** The per-user EARS-13
  ceiling is raised **5 → 10 / 15 min** so a normal forgot-password → login recovery
  flow is not throttled mid-journey (per-IP 20/15 min and per-ASN 100/h unchanged).
  A **successful** login AND a **successful** reset-complete now **forgive** (clear)
  the per-user window for that identifier (`RateLimitService.reset({ip, identifier})`,
  keyed identically to the guard), so a recovering user is never stranded. Only the
  per-user window is forgiven — per-IP / per-ASN are deliberately left intact. The
  throttled response stays generic (no account-existence oracle).

## 0.3.0

### Minor Changes

- [#199](https://github.com/doctor-school/ds-platform/pull/199) [`a381363`](https://github.com/doctor-school/ds-platform/commit/a38136342b366df2dcbac73f674e8f806cd3b6e9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): [#197](https://github.com/doctor-school/ds-platform/issues/197) enforce field validation/mask by construction — semantic field primitives + ESLint gate (003)

  Portal auth forms were assembled from raw design-system `<Input>` + a per-form
  loose resolver, so validation/mask was hand-wired field-by-field and easy to
  forget — the root cause of the live defects [#192](https://github.com/doctor-school/ds-platform/issues/192) (`/login` identifier) and [#196](https://github.com/doctor-school/ds-platform/issues/196)
  (`/reset` identifier). This lands the enforced-by-construction layer of EARS-22
  (003 design §8.2):

  - **Five semantic field primitives** (`apps/portal/components/fields`):
    `EmailField`, `PhoneField`, `OtpField`, `PasswordField`, and `IdentifierField`
    (the email-or-phone union box). Each bakes in validation + (where relevant) the
    E.164 phone mask + a11y + RU copy and co-locates its zod resolver fragment, so
    no per-call wiring. The loose `@ds/schemas` request contracts are unchanged.
  - **A custom ESLint gate** (`local/no-raw-auth-field-input`) that makes a raw
    credential `<Input>` — or a hand-rolled native `<input>` — impossible to render
    on the auth surfaces; the field must come from the primitives. Rides the
    existing `lint` CI job.
  - **All auth surfaces migrated** with behavior preserved ([#192](https://github.com/doctor-school/ds-platform/issues/192)/[#175](https://github.com/doctor-school/ds-platform/issues/175) intact), and
    **/reset identifier now validated + masked-aware** — the [#196](https://github.com/doctor-school/ds-platform/issues/196) fix.
  - **`@ds/schemas`** now exports the creation-password fragment as
    `NewPasswordSchema` (was a private `NewPassword`), so the portal composes the
    complexity baseline from the SSOT instead of re-declaring the regex — additive,
    the request schemas are unchanged.

- [#168](https://github.com/doctor-school/ds-platform/pull/168) [`f1e21ff`](https://github.com/doctor-school/ds-platform/commit/f1e21ffffdecdc26712fc6ae9ef92c19f1c53d01) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): [#131](https://github.com/doctor-school/ds-platform/issues/131) wire the portal auth journeys against the live BFF (003 F7)

  Feature 003 shipped the auth BFF (`apps/api`, all `/v1/auth/*` routes live) but
  NO portal wiring — the login page only `console.log`ged, there was no
  register/verify/OTP/reset surface, the OTP input was a visual stub, and the form
  re-declared its own zod schema. No auth journey was completable in a browser.
  This is the milestone-completing vertical slice: the integrating UI layer plus a
  real browser E2E so the slice works end to end.

  **Same-origin BFF proxy (mandatory).** The session is the `__Host-ds_session`
  cookie, which `__Host-` locks to the exact origin that set it (no Domain). So the
  portal serves the BFF under its OWN origin: a Next `rewrites()` maps `/v1/:path*`
  to an env-driven upstream (`API_PROXY_TARGET`), and every form fetches the
  relative `/v1/auth/*` path with `credentials: "include"`. No CORS, no
  cross-origin cookie, and the access/refresh tokens never reach client JS (EARS-8).

  **Surfaces.** `/register` (EARS-1/2, email|phone toggle + consent + bot-protection
  → pending_verification), `/verify` (EARS-3/4, OTP from Mailpit), `/login` —
  password (EARS-5, single `identifier` box matching `LoginRequestSchema`, NOT the
  old `email` field) AND passwordless OTP (EARS-6 email / EARS-7 SMS, channel
  selector + request/verify), `/reset` (EARS-11/12, initiate → complete), and an
  `/account` session shell that reads `GET /v1/auth/session`, attempts one silent
  `POST /refresh`-then-retry on a 401 (EARS-9) before redirecting to `/login`, and
  logs out (EARS-10).

  **Schemas SSOT.** Every form validates with the `@ds/schemas` zod schemas via
  `@hookform/resolvers/zod`; the re-declared `signInSchema` is deleted. A small
  `lib/auth-client.ts` carries the token-free same-origin fetch surface typed by
  the `@ds/schemas` request/response types.

  **Browser E2E (real-Zitadel tier).** A new Playwright suite mirrors the api
  `zitadel-otp-login.e2e-spec.ts` pattern exactly: it drives a real browser through
  register→verify→login(password)→session→logout and the email-OTP journey, reading
  the REAL codes from Mailpit (never the FakeIdpClient `424242`), and asserts the
  no-token invariant (only `__Host-ds_session`, HttpOnly; no access/refresh token in
  `document.cookie`/`localStorage`/`sessionStorage`/JWT-shaped blob). It is gated on
  the dev-stand env (`IDP_*` + `E2E_PORTAL_URL`) and `test.skip`s otherwise, so it is
  NOT wired into CI or `pnpm test` — a manual dev-stand gate, same posture as the api
  LIVE_OIDC specs. SMS-OTP has no dev-stand provider: the UI is built but the E2E
  declares it a parity-only skip, not faked green.

### Patch Changes

- [#201](https://github.com/doctor-school/ds-platform/pull/201) [`1e45957`](https://github.com/doctor-school/ds-platform/commit/1e45957ac70d20c67b80b7f612d85d8421fafb67) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Localize the creation-password complexity error to RU and validate auth forms on blur ([#200](https://github.com/doctor-school/ds-platform/issues/200), 003).

  `@ds/schemas` now exports `NEW_PASSWORD_COMPLEXITY`, the bare creation-password
  complexity regex, as the single SSOT for the pattern. `NewPasswordSchema` is
  rebuilt from it and keeps its deliberately-generic English DTO message unchanged
  (no API behavior change). The portal's `NewPasswordFieldSchema` composes the regex
  **without** a message so the localized resolver maps the resulting `invalid_format`
  issue to the RU `errors.validation.passwordComplexity` copy — in zod v4 a
  schema-level message would otherwise outrank the contextual error map and leak
  English on `/register` and `/reset`.

  `/register` and `/reset` (complete step) now resolve from portal-composed,
  channel-specific schemas built from the field primitives (mirroring the existing
  OTP-login pattern) instead of the request schemas; the submitted body and the API
  contract are unchanged. All auth forms run in `mode: "onTouched"` so a malformed
  email/phone/password is flagged on blur, before submit.

- Updated dependencies [[`1e45957`](https://github.com/doctor-school/ds-platform/commit/1e45957ac70d20c67b80b7f612d85d8421fafb67), [`a381363`](https://github.com/doctor-school/ds-platform/commit/a38136342b366df2dcbac73f674e8f806cd3b6e9)]:
  - @ds/schemas@0.7.0

## 0.2.0

### Minor Changes

- [#116](https://github.com/doctor-school/ds-platform/pull/116) [`abca9ca`](https://github.com/doctor-school/ds-platform/commit/abca9ca9ee9d7f07dfbaffcbe4d3c131b0bfa14e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api,portal): [#84](https://github.com/doctor-school/ds-platform/issues/84) bootstrap BotProtection abstraction + Yandex SmartCaptcha adapter

  003 is the platform's first consumer of bot protection, so it bootstraps the
  mechanism behind an interface rather than a separate package (design §10.1,
  ADR-0001 open-q [#7](https://github.com/doctor-school/ds-platform/issues/7)). Backend (`@ds/api`): a `BotProtection` provider interface
  (`verify(token, action, clientIp) → ok`) bound to the `BOT_PROTECTION` DI token,
  a Yandex SmartCaptcha adapter (RF-accessible; fail-closed on any error), a
  `@BotProtected(action)` decorator, and a global `BotProtectionGuard` that no-ops
  unless a handler opts in — so swapping the provider (DSO-26) never touches a call
  site. Disabled by default (`BOT_PROTECTION_ENABLED=false`) so the dev-stand runs
  without a Yandex account.

  Frontend (`@ds/portal`): a provider-neutral `BotProtectionField` wrapping a
  self-contained Yandex SmartCaptcha widget that emits the token the guard
  verifies, wired onto the sign-in scaffold. EARS-17 policy (which surfaces, when)
  is owned by 003 F1/F5/F6; this ships the mechanism only. Closes [#84](https://github.com/doctor-school/ds-platform/issues/84).

## 0.1.0

### Minor Changes

- [#114](https://github.com/doctor-school/ds-platform/pull/114) [`0feefc5`](https://github.com/doctor-school/ds-platform/commit/0feefc5a37768db4f03042688b22b64908a449c9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(frontend): scaffold apps/portal + graduate packages/design-system (auth-form set)

  Graduates `@ds/design-system` from a stub to the Tailwind CSS 4 + shadcn/ui
  owned-code component set the 003 inline auth forms need (ADR-0004 §6): a single
  token sheet (`globals.css`) whose one `--radius` derives the whole radius scale
  via `@theme inline`, plus `Button`, `Input`, `Label`, `Card`, the RHF `<Form>`
  binding (ADR-0004 §9), and `InputOTP`. Components ship as source and are
  transpiled by consumers (`transpilePackages`).

  Scaffolds `@ds/portal` as a Next.js 16 App Router app (`output: 'standalone'`,
  no Vercel runtime — ADR-0004 §2.3/§3/§7): app shell + a sign-in page wiring the
  RHF + `@hookform/resolvers/zod` + `<Form>` + `<InputOTP>` stack end to end. The
  BFF calls and the OIDC silent-re-auth middleware land with feature 003. Closes
  [#82](https://github.com/doctor-school/ds-platform/issues/82).

### Patch Changes

- Updated dependencies [[`0feefc5`](https://github.com/doctor-school/ds-platform/commit/0feefc5a37768db4f03042688b22b64908a449c9)]:
  - @ds/design-system@0.1.0
