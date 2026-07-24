# @ds/design-system

## 4.0.1

### Patch Changes

- Updated dependencies [[`88bc412`](https://github.com/doctor-school/ds-platform/commit/88bc412cb3620e83202979c9026e8505d3a696d1), [`7355ade`](https://github.com/doctor-school/ds-platform/commit/7355adea6c7d76b471deecdee774f339ce049750)]:
  - @ds/schemas@2.1.0

## 4.0.0

### Major Changes

- [#1151](https://github.com/doctor-school/ds-platform/pull/1151) [`807887e`](https://github.com/doctor-school/ds-platform/commit/807887e60668264b467e943f61d2e7e30ebbb335) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(006): Twitch-model webinar room — maximized player, viewport-bounded shell, collapsible minimal chat ([#1123](https://github.com/doctor-school/ds-platform/issues/1123))

  `WebinarRoomLayout` is reworked from the `1fr 400px` page-flow grid to a viewport-bounded flex shell: the page no longer scrolls, the player region is maximized (the embed iframe fills a dark letterbox, no custom player chrome — EARS-9), a one-line context strip sits under it, and the desktop chat is a 340px aside that collapses to a 44px rail with a live unread badge. The chat ledger becomes Twitch-minimal — borderless single-paragraph rows (no timestamps/avatars), `flex-col-reverse` stick-to-bottom with a «Новые сообщения ↓» chip, composer pinned. BREAKING: the primitive's props changed (new required `contextStrip`, `chatHeading`, `collapseLabel`, `expandLabel`; `context` now the mobile info-tab block; `player` is region content, not its own aspect box).

### Patch Changes

- Updated dependencies [[`326df3c`](https://github.com/doctor-school/ds-platform/commit/326df3cce477af6792d9f282e594888784cab69a)]:
  - @ds/schemas@2.0.0

## 3.1.0

### Minor Changes

- [#1148](https://github.com/doctor-school/ds-platform/pull/1148) [`f09fecd`](https://github.com/doctor-school/ds-platform/commit/f09fecd905942d611f80717fdf69c465d4efa244) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(header): dark-theme-safe profile chip + shared header user cluster

  - The white on-header chips (avatar / «Войти» / mobile ≡) now cast the
    theme-invariant `shadow-header-chip` tone (neutral.900 in both themes) instead
    of `shadow-btn` (whose `border` cast flips to white in dark). In dark theme the
    profile chip is no longer a white square with a white shadow on the navy band
    ([#1145](https://github.com/doctor-school/ds-platform/issues/1145)); light theme is pixel-identical.
  - The webinar-room header and the app-shell header now render one shared
    `HeaderUserCluster` (theme toggle + profile chip, toggle left / chip rightmost),
    so the room follows the shell's order and the chip presentation is a single
    source of truth ([#1146](https://github.com/doctor-school/ds-platform/issues/1146)).

## 3.0.0

### Major Changes

- [#1116](https://github.com/doctor-school/ds-platform/pull/1116) [`62892f6`](https://github.com/doctor-school/ds-platform/commit/62892f683c34885bb02b760480f4fb68b0283c7e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix: the alphanumeric registration / password-reset verification code no longer traps mobile users on a digits-only keyboard ([#1110](https://github.com/doctor-school/ds-platform/issues/1110)). `OtpField` (and `OtpFocusScreen`, which forwards it) gain a **required** `charset: "alphanumeric" | "numeric"` prop: the slotted variant now requests `inputMode="text"` + `autoCapitalize="characters"` for alphanumeric codes so a phone shows the full keyboard, and `inputMode="numeric"` for the digit login OTP. `/verify` and `/reset` pass `charset="alphanumeric"`; `/login` passes `charset="numeric"`.

  BREAKING (`@ds/design-system`): `charset` is a required prop on `OtpField` and `OtpFocusScreen` — every slotted call site must declare its code's character set (no silent default, so no surface can inherit the wrong mobile keypad).

### Patch Changes

- [#1113](https://github.com/doctor-school/ds-platform/pull/1113) [`c717a70`](https://github.com/doctor-school/ds-platform/commit/c717a70e3c587ffbec36239bc030d64dc724f765) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix: registration / password-reset verification code is now case-insensitive end-to-end. The `OtpField` slotted variant uppercases each keystroke, and the auth BFF trims + uppercases the code before the Zitadel verify / reset hop, so a doctor who types the UPPERCASE code lowercased (or whose keyboard/paste pads it) still verifies. No consumer-visible API change.

## 2.0.0

### Major Changes

- [#1101](https://github.com/doctor-school/ds-platform/pull/1101) [`6b6b36f`](https://github.com/doctor-school/ds-platform/commit/6b6b36f4267a96bb696a98acdf53024a7037d3cd) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#4](https://github.com/doctor-school/ds-platform/issues/4) (004, [#1098](https://github.com/doctor-school/ds-platform/issues/1098)): `MonthPicker` now pages years IN PLACE
  (owner verdict [#5](https://github.com/doctor-school/ds-platform/issues/5), item 4) — a client `<details>` that steps a server-provided year window
  without navigation (popover stays open, per-month counters swap), falling back to a
  server-navigation `<a>` at the window edge; the props move from `year`/`months` to
  `initialYear`/`years` (`MonthPickerYear[]`, new exported type). The trigger + year
  ‹ › steppers adopt the `Button` `outline` states so the trigger reads as a white
  bordered control on the navy hero, not the old filled-blue summary (verdict [#5](https://github.com/doctor-school/ds-platform/issues/5),
  items 1–2). `MonthCalendarGrid` gains an optional `prevMonthLink` — the «← <prev month>»
  return link rendered left of the always-on next-month link (verdict [#5](https://github.com/doctor-school/ds-platform/issues/5), item 5).

### Minor Changes

- [#1082](https://github.com/doctor-school/ds-platform/pull/1082) [`6e69dca`](https://github.com/doctor-school/ds-platform/commit/6e69dca014cddd58fe3d3fb3948dfe1b24143540) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the three deferred source §07 «Формы и валидация» field states ([#529](https://github.com/doctor-school/ds-platform/issues/529), deferred from [#512](https://github.com/doctor-school/ds-platform/issues/512)): (1) a **success** tone on `FormMessage` — a `success` prop renders the `✓ <msg>` confirmation (canvas `✓ Адрес подтверждён`) in a new AA-safe `success-text` token (the green mirror of `destructive-text`: light `green.700` #047857 at 5.49:1, dark `green.400`; the `success` fill stays 3.68:1 as text), with a green `success` border + `success-tint` fill on the input keyed on `data-success`; (2) a **required** prop on `Label` → the destructive `*` marker (`Email *`), `aria-hidden` so the programmatic required semantics stay on the input; (3) a **filled-border** on plain `Input` — a JS has-value signal (mirroring the OTP slot, not `:placeholder-shown`) switches the resting border `hairline` → ink `border` once the field holds a value, safe for controlled and uncontrolled usage. New primitive `green.700` + semantic `success-text` token.

### Patch Changes

- [#1079](https://github.com/doctor-school/ds-platform/pull/1079) [`5b725d7`](https://github.com/doctor-school/ds-platform/commit/5b725d733f653a6d45cc8c2bffaba85764aaad26) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month-calendar grid Stage-B rework [#2](https://github.com/doctor-school/ds-platform/issues/2) ([#1075](https://github.com/doctor-school/ds-platform/issues/1075), owner verdict [#2](https://github.com/doctor-school/ds-platform/issues/2) at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): a dedicated `calendar-muted` token (canvas-exact `oklch(0.985 0.002 250)` light / `oklch(0.185 0.02 250)` dark) replaces the shared `section` token on the month-grid day cell and the legend «Прошёл / пусто» swatch (the week-listing day band keeps `section`); every event pill's text run clamps at two lines via an inner `line-clamp-2` span (canvas `clamp2` — live pills included, the «+N ещё» link and past-day notes untouched); the `muted` cell prop and the `nextMonthLink` prop docs now state the owner rules (muted bg = weekend/out-of-month only; the link is always the displayed month + 1).

- [#1083](https://github.com/doctor-school/ds-platform/pull/1083) [`4e09ff2`](https://github.com/doctor-school/ds-platform/commit/4e09ff212b6fb808f4e0c7b70cf72f1b84cc3f8c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#3](https://github.com/doctor-school/ds-platform/issues/3) ([#1080](https://github.com/doctor-school/ds-platform/issues/1080), owner verdict [#3](https://github.com/doctor-school/ds-platform/issues/3) at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): the `container.calendar` token becomes a border-box 1336px cap (83.5rem = 1240px of content + 2 × 48px desktop-max gutter) so `Container variant="calendar"` yields the canvas-exact 1240px grid column — the canvas caps `main` at 1240px content-box with the gutter outside, Tailwind preflight is border-box (the week listing + hero inner bands sharing the variant widen identically); the light `header` token flips from blue.700 to the canvas headerBg blue.500 `#2D84F2` (dark stays blue.700 `#114D9E`), so the app chrome and the hero poster read as one continuous blue band (white-on-blue.500 large/bold precedent recorded at [#1072](https://github.com/doctor-school/ds-platform/issues/1072)); the month-grid live pill's text run drops from 800 to 700 (`font-bold`) — the same tier as a planned pill; the micro uppercase LIVE badges (Badge `live`, the webinar-card ribbon, the day-agenda chip) keep 800. A new `header-chip-foreground` semantic token (blue.700 `#114D9E` in BOTH themes — the canvas navy chip ink `color:#114D9E;background:#fff` every canvas renders regardless of theme) carries the white on-header chips' ink, since the light `header` (blue.500) fails normal-text AA on white (Mode-a on the PR).

- [#1104](https://github.com/doctor-school/ds-platform/pull/1104) [`2ff3a77`](https://github.com/doctor-school/ds-platform/commit/2ff3a77344b9f691603f8f433a57d4a7a3adbaf3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month view Stage-B rework [#5](https://github.com/doctor-school/ds-platform/issues/5) (004, [#1102](https://github.com/doctor-school/ds-platform/issues/1102), owner verdict [#6](https://github.com/doctor-school/ds-platform/issues/6)): `MonthPicker` trigger
  now renders one equal height with the toolbar's neighbour controls — the
  `<details>` wrapper is a `flex flex-col` and the `<summary>` fills it (`h-full`), so
  under the toolbar's `items-stretch` row the trigger no longer sits SHORTER than the
  ‹ › / «Сегодня» buttons. The client year state now resyncs to `initialYear` when it
  changes (a sibling soft-navigation re-renders the picker while the popover may be
  open), so it never shows the stale mount-seeded year. No prop-signature change —
  the app widens the `years` window and re-centres the edge-fallback href.

- [#1094](https://github.com/doctor-school/ds-platform/pull/1094) [`77931ba`](https://github.com/doctor-school/ds-platform/commit/77931bae0b435ae6af9238a9d195c95b8ab5638e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Navy light-theme top ([#1085](https://github.com/doctor-school/ds-platform/issues/1085), owner verdict [#4](https://github.com/doctor-school/ds-platform/issues/4) at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): the light `header` and `hero` semantic tokens repoint from the canvas bright blue.500 (#2D84F2) to production navy blue.700 (#114D9E), so the light top now equals the dark top and prod — one continuous navy band (dark set unchanged). White on blue.700 = 8.14:1, full normal-text AA in both themes, retiring the [#1083](https://github.com/doctor-school/ds-platform/issues/1083) large-text-nav carve-out route (rejected by the owner). `header-chip-foreground` is value-unchanged; token `$description`s that named the light header/hero as bright blue are rewritten inline. The vendored `design-source/*.dc.html` canvases still render #2D84F2 light — the recorded owner-directed deviation pending the DesignSync follow-up.

## 1.3.0

### Minor Changes

- [#1058](https://github.com/doctor-school/ds-platform/pull/1058) [`036ad36`](https://github.com/doctor-school/ds-platform/commit/036ad361041800f28509077c53c5f2abc4fb0651) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): 004 EARS-19 — month-calendar view at `/webinars?view=month` (desktop 7-column grid, mobile dot-grid + selected-day agenda). Adds the display-only `MonthCalendarGrid`, `MonthDotGrid`, and `DayAgenda` presentation blocks to `@ds/design-system` (token-only, catalogued in the showcase), and wires the portal pane: current-МСК-month projection read, live pill/dot from `EventLifecycleState`, muted past-day notes, today outline, state legend, and the «Неделя / Месяц» switcher ([#1050](https://github.com/doctor-school/ds-platform/issues/1050)).

- [#1060](https://github.com/doctor-school/ds-platform/pull/1060) [`952645b`](https://github.com/doctor-school/ds-platform/commit/952645b4ea780989996d4a1e00a18ec8e0718fde) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): 004 EARS-17/18 — month navigation (‹ › paging + 12-month picker) and the «Неделя / Месяц» view switcher on `/webinars?view=month`. Adds the display-only `MonthPicker` presentation block to `@ds/design-system` (native `<details>` disclosure, year ‹ › stepper, per-month event counts, past months muted «прошёл»; token-only, catalogued in the showcase) and wires the portal month toolbar: server-component query-param paging (validated `month`, absent/malformed → current МСК month), the `MonthlyEventCount` picker feed, a «Сегодня» reset, and the shared `ViewSwitcher` that carries the displayed month so the week↔month round-trip is loss-free ([#1051](https://github.com/doctor-school/ds-platform/issues/1051)).

### Patch Changes

- [#1072](https://github.com/doctor-school/ds-platform/pull/1072) [`3f9cca7`](https://github.com/doctor-school/ds-platform/commit/3f9cca7cead1783cf956f9d6fa6249e9246d52e4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Month-calendar canvas-parity fixes ([#1065](https://github.com/doctor-school/ds-platform/issues/1065), Stage-B rework at [#1052](https://github.com/doctor-school/ds-platform/issues/1052)): `cn()` registers the missing custom font sizes (`text-eyebrow`, `text-title-lg`) so tailwind-merge no longer strips them as colour conflicts — the [#1052](https://github.com/doctor-school/ds-platform/issues/1052) off-scale defect; the month-grid pill is a single inline text run (block, wraps inside its cell — closes the 4-events/day overflow); a desktop day cell caps at 3 pills with a «+N ещё» overflow link slot; the legend row gains the next-month accent link slot; new `hero`/`hero-foreground`/`hero-muted` tokens (the discovery poster band, blue.500 light / blue.700 dark); the month-picker trigger spreads across a stretched mobile container.

- Updated dependencies [[`0cbe990`](https://github.com/doctor-school/ds-platform/commit/0cbe9904884bcf6d6b2e4801e3f85726be549cc7)]:
  - @ds/schemas@1.4.0

## 1.2.1

### Patch Changes

- Updated dependencies [[`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344)]:
  - @ds/schemas@1.3.0

## 1.2.0

### Minor Changes

- [#781](https://github.com/doctor-school/ds-platform/pull/781) [`325fef7`](https://github.com/doctor-school/ds-platform/commit/325fef762d4f36db282d2d6d07905145584673f8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Header band deepened to blue.700 for WCAG-AA ([#713](https://github.com/doctor-school/ds-platform/issues/713)): the `header` semantic token now resolves to blue.700 (`#114d9e`) instead of blue.500 (`#2d84f2`). White `header-foreground` on the band goes from 3.69:1 (which met only the large/bold ≥3:1 carve-out) to 8.14:1, clearing AA for normal-weight body text as well. blue.700 is already the dark-theme header value, so the header band is now identical in both themes. This is a global token change — it affects every brand-chrome header band across all apps.

### Patch Changes

- Updated dependencies [[`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb)]:
  - @ds/schemas@1.2.0

## 1.1.0

### Minor Changes

- [#747](https://github.com/doctor-school/ds-platform/pull/747) [`3dd3039`](https://github.com/doctor-school/ds-platform/commit/3dd303994ae9f7b439bd85282938940fbde36ab4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - New `header-hairline` semantic token (006 design §10, [#702](https://github.com/doctor-school/ds-platform/issues/702)): the on-header muted border — white at 50% over the header band, the canvas `rgba(255,255,255,.5)` — same value in both theme sets; used by the webinar-room header's icon-button family (the theme toggle's 2px resting border, hover raising to full-strength `header-foreground`).

## 1.0.0

### Major Changes

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

- Updated dependencies [[`29ae731`](https://github.com/doctor-school/ds-platform/commit/29ae731096a929745d64800e97d059bded702605)]:
  - @ds/schemas@1.1.0

## 0.8.0

### Minor Changes

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

- [#680](https://github.com/doctor-school/ds-platform/pull/680) [`da579b0`](https://github.com/doctor-school/ds-platform/commit/da579b0450b90ea48e40c37f5c7051b3e32e6f75) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 006 EARS-2 — room composition + embed player from the explicit provider enum.

  - `@ds/schemas`: `RoomConfigSchema` gains the additive, nullable `stream`
    (`{ provider, embedRef } | null`) reusing the `StreamConfig` SSOT — the
    server-produced embed source the room instantiates the player from. A gated
    caller for a `live` event with no/unknown stream config still receives a grant
    with `stream: null` (the truthful "stream unavailable" room state); the provider
    is read from the closed enum, never URL-sniffed.
  - `@ds/design-system`: new `WebinarRoomLayout` primitive — the neo-brutalist room
    composition shell to the `webinar-room.dc.html` geometry (desktop `1fr 400px`
    player + chat aside; mobile full-bleed player + Чат / О эфире tabs).

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

### Patch Changes

- Updated dependencies [[`70f5e3e`](https://github.com/doctor-school/ds-platform/commit/70f5e3e80c90a1738096c2909165a682dd6ee9c7), [`ce4b05d`](https://github.com/doctor-school/ds-platform/commit/ce4b05dd06d5d0c2ed39e04b87f7cca2d396185b), [`1547fa4`](https://github.com/doctor-school/ds-platform/commit/1547fa4afa1ffcf84290e28a9b2eef368743763c), [`31b97f2`](https://github.com/doctor-school/ds-platform/commit/31b97f246adfad18d56c336a6559234b1a26c26a), [`e3ce9eb`](https://github.com/doctor-school/ds-platform/commit/e3ce9eb7780d283d52e32321e1fc145ec1720981), [`59bbc2e`](https://github.com/doctor-school/ds-platform/commit/59bbc2ed5ff990402c97f755b230a03696c84ff3), [`f20f1da`](https://github.com/doctor-school/ds-platform/commit/f20f1da596fce75b03c6696b968e52f95566934c), [`b46b15a`](https://github.com/doctor-school/ds-platform/commit/b46b15ad2e7b37d0129db0461240979544438c10), [`2993933`](https://github.com/doctor-school/ds-platform/commit/29939330ee4c3e904842e699e512fe632d8deb9f), [`1b80b39`](https://github.com/doctor-school/ds-platform/commit/1b80b39a7e69c490425d96fd0eedab1bb63d24e7), [`c99ba53`](https://github.com/doctor-school/ds-platform/commit/c99ba534eb7b7e3b1816b43baa7b645edec98550), [`074d2e7`](https://github.com/doctor-school/ds-platform/commit/074d2e78c828fe86687c31038ed61e7285e681d9), [`bac9f1e`](https://github.com/doctor-school/ds-platform/commit/bac9f1eaceca4fb20da17b4e1bdba5fe8effdd66), [`05f0964`](https://github.com/doctor-school/ds-platform/commit/05f0964d92f288ba58e05364e82ae01076afb9e2), [`da579b0`](https://github.com/doctor-school/ds-platform/commit/da579b0450b90ea48e40c37f5c7051b3e32e6f75), [`c959008`](https://github.com/doctor-school/ds-platform/commit/c9590083f62c08b274311dbfe101ba914425d873), [`9d5fc7c`](https://github.com/doctor-school/ds-platform/commit/9d5fc7c14cc44a0e4db071329e8581ddc3d5a211)]:
  - @ds/schemas@1.0.0

## 0.7.0

### Minor Changes

- [#561](https://github.com/doctor-school/ds-platform/pull/561) [`73dcd7f`](https://github.com/doctor-school/ds-platform/commit/73dcd7f1c9b16d7b008f9e5015fe34531eac66fa) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix dark-theme AA-contrast defects surfaced by the [#515](https://github.com/doctor-school/ds-platform/issues/515) full-page dark axe scan ([#537](https://github.com/doctor-school/ds-platform/issues/537)):

  - **`destructive` dark fill** now lifts to `#C81E1E` (red.500, white 5.50:1) instead of `#E15555` (3.73:1, below the 4.5:1 normal-text floor) — the destructive Button and invalid-input fill now clear AA in dark. Owner-approved value against the `design-source/design-system.dc.html` danger family.
  - **New `destructive-text` role** carries the field/form error MESSAGE text (`FormMessage` / `FormError`), split from the `destructive` FILL: a fill under white text needs a dark red, but the same red as text on the near-black dark card is only 3.09:1, so error text rides its own token (light `#C81E1E` / dark `#E15555`, 4.75:1) and stays legible in both themes.
  - **New `primary-surface-muted` role** (`#cfdbec`, 5.81:1 on the blue.700 brand panel) replaces the element `opacity-*` dim on the `AuthLayout` brand-aside sub-copy (eyebrow / value-prop / footer) with a real AA-safe token.

  The runtime `playwright-axe` scan now runs every showcase route in **both** themes (light + dark), so dark-mode AA regressions are machine-caught.

## 0.6.0

### Minor Changes

- [#536](https://github.com/doctor-school/ds-platform/pull/536) [`8ae9f6f`](https://github.com/doctor-school/ds-platform/commit/8ae9f6f448896e6aca92f24cee2264dc95bbf796) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Emit a `.light` forced-light theme reset alongside `.dark`. `:root` declares the light theme document-wide but cannot reset a subtree nested inside a `.dark` ancestor (CSS custom properties inherit), so a region that must stay light under a dark page had no affordance. The token build now also writes the light semantic colour roles under an explicit `.light` class — the mirror of `.dark` — so any subtree can pin light regardless of an ancestor theme. Additive (no token values change); enables the showcase's runtime page-level theme toggle to keep its light/dark specimen pairs side-by-side, and gives product apps a forced-light island (e.g. a print preview) for free.

- [#531](https://github.com/doctor-school/ds-platform/pull/531) [`2e95bcd`](https://github.com/doctor-school/ds-platform/commit/2e95bcd2892b4fe56895d5561a0980b9aaf75a69) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the §09 «Раскладка и ритм» layout & spatial-rhythm system to `@ds/design-system` (source `design-source/design-system.dc.html` §09 + §03). Space is now composed by semantic **ROLE**, not by eye:

  - **Container** primitive (`./container`, `content` | `calendar` variants) — centres the content column, caps it (1104px / 1240px), and owns the responsive gutter + breakpoint: at/above the new `layout` breakpoint (901px) the cap engages with a `clamp(16px, 4vw, 48px)` gutter; below it the column goes edge-to-edge on a fixed 16px gutter so day-band plates and cards can bleed.
  - **Semantic spacing-role tokens** over the §03 4px scale, surfaced as named Tailwind utilities via the `--spacing-<role>` `@theme` namespace: `inset` (`p-inset`), `stack` (20px mobile / 28px desktop — `space-y-stack-sm layout:space-y-stack`), `section` (48px desktop / 32px `section-sm` between mobile day groups — mobile rhythm = 20 intra-day / 32 between days is a recorded owner Stage-B decision, 2026-07-06, superseding the canvas's flush mobile gaps), `controls` (`gap-controls`), `inline` (`gap-inline`), `gutter` (`px-gutter` / `-mx-gutter` bleed), `day-band` (0 / bleed).
  - **Tokens:** `container.content`/`container.calendar` (→ `max-w-content` / `max-w-calendar`), the `breakpoint.layout` threshold, and the `semantic.space.*` role group; plus the webinar-card canvas dimensions — `font.size.eyebrow` (11px, `text-eyebrow`), `font.size.title-lg` (24px listing-card title, `text-title-lg`), `webinar-card.time-plate` (196px time plate, `w-time-plate`) and the `tracking-numeric` utility (−.04em tabular-time tracking). `tokens.css` + `allowed-tokens.json` regenerated (tokens-fresh idempotent).

  Token-only, square, both themes. Documented in the package README (Layout & spatial rhythm §09); the showcase gains a live **Layout & rhythm** composition rebuilt element-by-element from the vendored `webinar-card.dc.html` + `webinars-listing.dc.html` canvases — desktop bordered cards with the 196px time plate and blue offset casts, mobile flat full-bleed cards separated by their tint plates, both breakpoints × both themes.

- [#521](https://github.com/doctor-school/ds-platform/pull/521) [`42ce21f`](https://github.com/doctor-school/ds-platform/commit/42ce21f6999cea3f784d5d051cb53ce43dbd2031) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Codify the neo-brutalist visual language into the DTCG token SoT. Structural repaint of the design tokens: **radius 0** (flat, non-rounded system — the Tailwind `rounded-*` ladder collapses onto `--radius-control`), **hard offset shadows** (blur-0, theme-aware cast tones via the new `elevation`/`elevation-soft` roles), a **hard structural `border`** (near-black outline) split from a subtle `hairline` divider, the **amber `warning`** family with dark-ink foreground (white fails AA on amber), an expanded type scale (kegel 10–56) with an `extrabold` (800) weight, role-named letter-spacing, and a `micro-label` eyebrow composite. The AA action-fill triad (`primary-action`/`primary-hover`/`primary-pressed`) and brand `primary` anchor are preserved. Tokens only — no consumer wired.

- [#530](https://github.com/doctor-school/ds-platform/pull/530) [`d7327b4`](https://github.com/doctor-school/ds-platform/commit/d7327b440490d50e8e146b6649e6778f18b01cf9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add the nine new-language primitives to `@ds/design-system` (source `design-source/design-system.dc.html` §05–§08): **FilterChip** (interactive `aria-pressed` toggle), **Badge** (`live` pulsing indicator + `label`/`speaker` tint tags), **Avatar** (square initials, two fills), **Checkbox** / **Radio** / **Switch** (real native controls — keyboard + focus native — behind styled 22×22 / round / 46×26 visuals with the flush 3px focus ring), **Alert** (info/success/warn/danger callouts with `role=status|alert`), **Skeleton** (composable pulsing loader), and **DayBand** (full-bleed section plate). Adds the supporting semantic tokens (`info`, `live`/`live-foreground`, `success-tint`, `warning-tint`, `chip-border`), a `tracking-micro` utility, and the `live-pulse` animation (`animate-live-pulse` / `animate-skeleton-pulse`). Token-only, square, both themes; the danger/live red is the source's invariant `#C81E1E` in both themes (not the theme-flipping `destructive`).

- [#538](https://github.com/doctor-school/ds-platform/pull/538) [`3812ebb`](https://github.com/doctor-school/ds-platform/commit/3812ebb910ff24efc7012b3e44cdf0b477f29e53) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-skin the auth blocks to the neo-brutalist language ([#517](https://github.com/doctor-school/ds-platform/issues/517)). `AuthCard` now promotes
  its `icon` into a square tint badge tile above an up-scaled, heavy title (canvas
  `auth-card` unit); `AuthLayout` collapses its split-shell at the semantic `layout`
  breakpoint (≥901px, §09 — the token match for the canvas ≤900px fold) instead of the
  generic `lg`. `OtpFocusScreen` inherits the neo-brutalist slots/buttons from its
  already-re-skinned primitives ([#512](https://github.com/doctor-school/ds-platform/issues/512)). Adds the semantic `primary-surface-foreground`
  token (white in BOTH themes) and repaints the `AuthLayout` brand panel with it — the
  action-pair `primary-foreground` repoints to dark ink in `.dark`, which rendered the
  dark-theme panel unreadable; the mispairing is now caught statically by
  `aa-contrast-lint`. Purely visual — no public prop changed and no behaviour touched
  (form logic, resend cooldown, masked destination all unchanged).

- [#528](https://github.com/doctor-school/ds-platform/pull/528) [`c58320b`](https://github.com/doctor-school/ds-platform/commit/c58320b97509472f15fbc5e73406ba758855e76d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Re-skin the core interactive primitives to the neo-brutalist visual language (button, input, label, link, tabs, form, card, input-otp, and the `fields/*` composites). Built from the vendored canvas fidelity SoT (`design-source/design-system.dc.html`): square corners (radius 0), a hard 2px structural border, and hard offset shadows (blur-0) whose **cast colour is per-variant** — a filled action casts in the ink `border` tone, a bordered surface casts in the soft `elevation-soft` tone (new component-shadow tokens, since `--shadow-md` bakes the blue `elevation` cast). Interaction: hover translates `(2px,2px)` as the offset shrinks, press translates `(4px,4px)` as it collapses, focus adds the 3px ring alongside. Tabs become a segmented control; the card sits on the 6px elevation cast; OTP slots are 40px squares (hairline → ink border when filled); the inline form error takes the source's `⚠` + weight-700 danger tone. Both themes. No API change — visual re-skin only.

### Patch Changes

- [#546](https://github.com/doctor-school/ds-platform/pull/546) [`2dbd927`](https://github.com/doctor-school/ds-platform/commit/2dbd927442738b81d533492563482da36a811b93) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the OTP slot row overflowing a narrow card body ([#544](https://github.com/doctor-school/ds-platform/issues/544)). `InputOTPGroup` and each
  `InputOTPSlot` now carry `min-w-0`, and the slot is an `aspect-square` cell with a
  preferred `w-10` width (the approved [#512](https://github.com/doctor-school/ds-platform/issues/512) deviation from the canvas 42×52 wrapped
  inputs): the 8-slot login row shrinks to fit at 390px instead of overflowing the page
  body by ~30px, while wide layouts — including 6-slot verify/reset rows and multi-group
  compositions with a separator — keep the unchanged 40px square cell and their existing
  geometry. Both themes; neo-brutalist contiguous shared-border look preserved.

- [#543](https://github.com/doctor-school/ds-platform/pull/543) [`63e72ce`](https://github.com/doctor-school/ds-platform/commit/63e72ce6667e233eb05e3733a73778f31a216298) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the resend-cooldown row overflowing the auth card frame ([#542](https://github.com/doctor-school/ds-platform/issues/542)). The `Button` base carries `whitespace-nowrap`, so the longer verify/reset resend copy («Отправить повторно можно через N с») could neither wrap nor shrink in the `justify-between` row and pushed past the card's right border (owner-reported on /reset). Two changes: (1) the verify + reset resend copy now matches the canvas canonical form the login OTP screen already uses — «Отправить снова» / «Отправить снова · N с»; (2) the resend control on the shared `<OtpFocusScreen>` block and the inline reset/verify rows gains `min-w-0 whitespace-normal text-right` (with `shrink-0` on the neighbouring change-method / start-over control) so the cooldown label wraps instead of overflowing at any width, both themes. Cooldown timing/logic unchanged.

## 0.5.2

### Patch Changes

- Updated dependencies [[`88514b6`](https://github.com/doctor-school/ds-platform/commit/88514b60c93d47805dcc71539e84f89f8b2edda8)]:
  - @ds/schemas@0.9.0

## 0.5.1

### Patch Changes

- [#404](https://github.com/doctor-school/ds-platform/pull/404) [`18de7ef`](https://github.com/doctor-school/ds-platform/commit/18de7ef2a24bbbe5b69d73ca6a1837e864d53437) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Fix the inactive `Tabs` trigger to use the AA-safe quiet tier `text-muted-foreground` (full strength) instead of an opacity-dimmed `text-foreground/60`. An opacity modifier on a foreground token drops it below the WCAG-AA contrast threshold ([#270](https://github.com/doctor-school/ds-platform/issues/270)); the muted-foreground token is the designated quiet-but-readable tier. Hover still resolves to full `text-foreground`. Surfaced by the new static `aa-contrast` guard ([#402](https://github.com/doctor-school/ds-platform/issues/402)) and confirmed AA-clean by the showcase axe scan ([#351](https://github.com/doctor-school/ds-platform/issues/351)).

## 0.5.0

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

## 0.4.0

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

- Updated dependencies [[`0c679fa`](https://github.com/doctor-school/ds-platform/commit/0c679faae7a1639341a575638316064c7592cb56)]:
  - @ds/schemas@0.8.0

## 0.3.0

### Minor Changes

- [#295](https://github.com/doctor-school/ds-platform/pull/295) [`8645614`](https://github.com/doctor-school/ds-platform/commit/8645614d9fe5dc194a65b619cb65ae58641309e4) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(266): `OtpFocusScreen` gains a `resendNonce` prop that restarts the resend
  cooldown without a remount. The block previously re-seeded its countdown only
  when `cooldownSeconds` changed, so a resend re-issuing the same duration could
  not restart it — the portal login worked around this by remounting the verify
  form via `key={resendNonce}`. Consumers now bump `resendNonce` instead; the
  portal login drops the remount hack and clears the stale code explicitly on the
  same signal.

## 0.2.0

### Minor Changes

- [#287](https://github.com/doctor-school/ds-platform/pull/287) [`0df9312`](https://github.com/doctor-school/ds-platform/commit/0df9312d3333e81d49039146e4b23c8ca8ac777a) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(285): WCAG-AA contrast on the auth surfaces (ADR-0013 §7). The filled primary `Button` no longer paints `primary` (blue.500 #2D84F2 — white only 3.69:1). A new accessible action-fill triad carries it: `primary-action` (blue.700 #114D9E, white 8.14:1, resting) → `primary-hover` / `primary-pressed` (blue.800 #0D3A77, 11.12:1), so every state clears AA while keeping a visible resting→hover interaction delta ([#270](https://github.com/doctor-school/ds-platform/issues/270) L1/L3). `primary` stays blue.500 as the brand anchor (link text, focus ring, icons, tints). `muted-foreground` darkens neutral.500 → neutral.600 (on `muted` neutral.100: 4.31:1 → 6.77:1), fixing the inactive Tabs-trigger contrast. The L4 axe-core scan on `/login` `/register` `/reset` is now green and promoted WARN → BLOCK.

- [#268](https://github.com/doctor-school/ds-platform/pull/268) [`83ff3fd`](https://github.com/doctor-school/ds-platform/commit/83ff3fd06559a24d73a0a8467a4d2ff6773c6ae0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(237): rebuild the portal auth surfaces on the design system — the reference vertical slice. login / register / verify / reset are re-skinned onto tokens + blocks from `@ds/design-system`, wrapped in the new `AuthLayout` split-screen block (shadcn `login-03`, re-skinned to tokens) with the Doctor School brand applied (Inter, SVG wordmark logo). The brand panel uses the new AA-safe `primary-surface` token (blue.700 `#114D9E`, white 8.14:1) — `primary` (blue.500) only clears AA for large/bold text, so a colour panel carrying normal-weight copy uses `primary-surface` (ADR-0013 §7). Logos ship as SVG (ADR-0013 §8): the clean white variant sits directly on the panel (no `bg-card` chip), and the form-column logo is `lg:hidden` so there is exactly one logo per viewport. Passwordless OTP login now renders the `OtpFocusScreen` block once a code is requested — masked destination + auto-submit + resend-with-cooldown + change-method — closing the [#192](https://github.com/doctor-school/ds-platform/issues/192)/[#196](https://github.com/doctor-school/ds-platform/issues/196)/[#200](https://github.com/doctor-school/ds-platform/issues/200)/[#211](https://github.com/doctor-school/ds-platform/issues/211)/[#212](https://github.com/doctor-school/ds-platform/issues/212)/[#227](https://github.com/doctor-school/ds-platform/issues/227) papercut class. Masked destinations also applied to the verify/reset code steps. App glue (BFF `/v1/auth/*`, EARS-16 generic errors, i18n, auto-submit) is unchanged — only the presentation layer moved onto the system.

- [#278](https://github.com/doctor-school/ds-platform/pull/278) [`74508d6`](https://github.com/doctor-school/ds-platform/commit/74508d69d293fb3ca418dee638e4719f2fb7b7e7) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(272): global interaction-state base-reset in `globals.css` `@layer base` (ADR-0013 §7 layer 1). Restores `cursor: pointer` for enabled interactive elements (`button`, `[role="button"]`, `summary`, `label[for]`, `select`) and `cursor: not-allowed` for `:disabled` / `[aria-disabled="true"]` — fixing the Tailwind v4 Preflight regression that dropped the v3 `button { cursor: pointer }` reset — and adds a `@media (prefers-reduced-motion: reduce)` guard that neutralises transitions/animations platform-wide. One place; covers every current, future, and third-party element, so no component class needs to repeat it.

- [#281](https://github.com/doctor-school/ds-platform/pull/281) [`8b986ff`](https://github.com/doctor-school/ds-platform/commit/8b986ffcad8e39e592c3be5db4c565211c18d185) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(273): interaction-state contract on primitives (ADR-0013 §7 layer 2). A shared `interactiveBase` fragment (focus-visible ring + colour transition + disabled dim, token-only) is now composed into `Button`, `Input`, and `TabsTrigger` so the contract travels with the component. `Button` gains an `active:` press state per variant and a `loading` prop (renders a spinner, sets `aria-busy`, and blocks interaction; `asChild` keeps its single-child Slot contract and only forwards `aria-busy`). `TabsTrigger` gains a hover affordance on inactive tabs. `interactiveBase` is exported for app-authored interactive elements. Layer 1 ([#272](https://github.com/doctor-school/ds-platform/issues/272)) still owns cursor + `prefers-reduced-motion` globally.

### Patch Changes

- [#289](https://github.com/doctor-school/ds-platform/pull/289) [`2253f43`](https://github.com/doctor-school/ds-platform/commit/2253f43a8337e2b64fbeb138784035209007f0ee) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(237): brand panel left / form right — the recorded column-order decision. The `AuthLayout` split-screen shipped with the inherited shadcn `login-03` default (form-left / panel-right), but the [#237](https://github.com/doctor-school/ds-platform/issues/237) settled product-owner decision is brand-panel LEFT, form RIGHT. The form column stays first in source order (a11y — the interactive surface precedes the decorative panel) and is flipped visually on `lg+` via `lg:order-2` (panel `lg:order-1`); the `< lg` single-column layout (panel hidden, form fills) is unchanged.

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
