# @ds/admin

## 0.2.7

### Patch Changes

- Updated dependencies [[`6e69dca`](https://github.com/doctor-school/ds-platform/commit/6e69dca014cddd58fe3d3fb3948dfe1b24143540), [`5b725d7`](https://github.com/doctor-school/ds-platform/commit/5b725d733f653a6d45cc8c2bffaba85764aaad26), [`4e09ff2`](https://github.com/doctor-school/ds-platform/commit/4e09ff212b6fb808f4e0c7b70cf72f1b84cc3f8c), [`6b6b36f`](https://github.com/doctor-school/ds-platform/commit/6b6b36f4267a96bb696a98acdf53024a7037d3cd), [`2ff3a77`](https://github.com/doctor-school/ds-platform/commit/2ff3a77344b9f691603f8f433a57d4a7a3adbaf3), [`77931ba`](https://github.com/doctor-school/ds-platform/commit/77931bae0b435ae6af9238a9d195c95b8ab5638e)]:
  - @ds/design-system@2.0.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`036ad36`](https://github.com/doctor-school/ds-platform/commit/036ad361041800f28509077c53c5f2abc4fb0651), [`3f9cca7`](https://github.com/doctor-school/ds-platform/commit/3f9cca7cead1783cf956f9d6fa6249e9246d52e4), [`952645b`](https://github.com/doctor-school/ds-platform/commit/952645b4ea780989996d4a1e00a18ec8e0718fde), [`0cbe990`](https://github.com/doctor-school/ds-platform/commit/0cbe9904884bcf6d6b2e4801e3f85726be549cc7)]:
  - @ds/design-system@1.3.0
  - @ds/schemas@1.4.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`0a49a96`](https://github.com/doctor-school/ds-platform/commit/0a49a9678325f66e56b5ea4c35c28d8a2d5a9344)]:
  - @ds/schemas@1.3.0
  - @ds/design-system@1.2.1

## 0.2.4

### Patch Changes

- Updated dependencies [[`33f2156`](https://github.com/doctor-school/ds-platform/commit/33f2156dfb2da61cfd5e7657d7a158eaa25122eb), [`325fef7`](https://github.com/doctor-school/ds-platform/commit/325fef762d4f36db282d2d6d07905145584673f8)]:
  - @ds/schemas@1.2.0
  - @ds/design-system@1.2.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`3dd3039`](https://github.com/doctor-school/ds-platform/commit/3dd303994ae9f7b439bd85282938940fbde36ab4)]:
  - @ds/design-system@1.1.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`29ae731`](https://github.com/doctor-school/ds-platform/commit/29ae731096a929745d64800e97d059bded702605), [`54e425d`](https://github.com/doctor-school/ds-platform/commit/54e425dda80c41de342e87c3b405bc7c1606197f)]:
  - @ds/schemas@1.1.0
  - @ds/design-system@1.0.0

## 0.2.1

### Patch Changes

- [#697](https://github.com/doctor-school/ds-platform/pull/697) [`2e8e20c`](https://github.com/doctor-school/ds-platform/commit/2e8e20c5c4c2f9d490d814d40adae679179b1b08) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(auth): redirect authenticated sessions away from auth surfaces to their destination ([#675](https://github.com/doctor-school/ds-platform/issues/675))

  An already-authenticated visitor could still open the portal auth surfaces
  (`/login`, `/register`, `/reset`, `/verify`) and the admin `/login`, and re-walk
  the whole register→verify→login flow. Now an authenticated visitor hitting any of
  those surfaces is redirected to their destination (portal → `/account`, admin →
  the `events` root) with no auth form rendered: the portal wires a single session
  guard into the shared `<AuthShell>`, and the admin wraps its login form in Refine's
  `<Authenticated>`.

## 0.2.0

### Minor Changes

- [#660](https://github.com/doctor-school/ds-platform/pull/660) [`651fe53`](https://github.com/doctor-school/ds-platform/commit/651fe530c89d4197f9924cf3e01065b237cb93f9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(admin): 007 admin integration + full-arc browser E2E ([#595](https://github.com/doctor-school/ds-platform/issues/595))

  The `apps/admin` app (Next.js 16 + **Refine** CSR shell, ADR-0004 §3/§5) now
  carries the **feature 007** event-admin surface end-to-end — the operator/director
  tooling that authors the webinar aggregate the rest of the epic reads. This is the
  `user-facing` vertical-slice deliverable no single EARS handler owns (requirements
  Verification `all` row): the Refine admin↔API wiring plus the browser run of the
  full arc.

  - **Refine wiring** — a custom REST **data provider** over `/v1/admin/events`
    (list / detail / multipart create+edit with program-PDF upload / stream config /
    the named lifecycle transitions), an **auth provider** over the shipped 003 BFF
    (`/v1/auth/*`, same-origin `__Host-ds_session` proxy — 007 adds no auth
    primitive), and an **access-control provider** gating on `platform_admin`.
  - **Event surface** — a list (all states, lifecycle badge, air time in МСК), a
    create/edit form (full aggregate + ordered free-text speakers + replaceable
    program PDF), the stream config (closed enum `rutube | youtube` + embed ref), and
    a lifecycle action bar whose offered actions derive **only** from the
    server-supplied `validTransitions` (the UI offers only valid moves; the api guard
    is the authority — EARS-7).
  - **EARS-8** — the surface bounces a non-`platform_admin`; the api `AuthzGuard`
    refuses `doctor_guest`/public on every write regardless of the UI.
  - **EARS-9** — one source of truth asserted across every lifecycle state against
    the 004 read models (`apps/api/test/admin/state-single-source.e2e-spec.ts`): the
    state 007 writes is exactly what the public page + listing resolve; the aggregate
    carries one lifecycle field, no legacy boolean visibility scatter.
  - **EARS-10** — RU admin surface, no hardcoded user-facing string (the
    `no-hardcoded-display-string` ESLint gate now covers `apps/admin`); every absolute
    time renders in МСК from the canonical instant (asserted with a Playwright
    `timezoneId` override).
  - **EARS-11** — stock Refine + `@ds/design-system` (adopt-before-bespoke recorded;
    no admin canvas exists — Stage-A gap), token-lint green.
  - **Browser E2E** — `apps/admin/e2e/` translates `007-scenarios.feature` via
    **playwright-bdd**: the full arc (create → publish → configure stream → open →
    close → archive) plus invalid-transition / closed-provider-enum / МСК-no-drift /
    non-admin refusal, on the live dev stand (real Postgres + Zitadel + MinIO). A
    manual, dev-stand-gated gate (not CI), mirroring the portal e2e tier.

- [#674](https://github.com/doctor-school/ds-platform/pull/674) [`05f0964`](https://github.com/doctor-school/ds-platform/commit/05f0964d92f288ba58e05364e82ae01076afb9e2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Admin forms now validate on the client with rendered RU error messages ([#665](https://github.com/doctor-school/ds-platform/issues/665), 007
  EARS-10, Stage-B feedback on [#660](https://github.com/doctor-school/ds-platform/issues/660) + rework round 2). ALL admin forms — the login
  form, the create/edit event form, and the stream-config form — derive their rules
  from the `@ds/schemas` / `@ds/design-system` field-schema SSOT (react-hook-form + a
  localized zod→RHF resolver mapping structured issues to the RU catalog), with
  native browser validation suppressed (`noValidate`), surfacing required / bounds /
  format errors inline before the round-trip while the server Zod DTO stays the
  authority.

  **Breaking (`@ds/schemas`):** the stream `embedRef` SSOT is tightened from a
  bounded free token to the provider's REAL id shape (`EMBED_REF_SHAPES`): `youtube`
  = the 11-char video id (`[A-Za-z0-9_-]{11}`), `rutube` = the 32-char lowercase-hex
  video id. A URL-shaped value stays refused with its own message; a garbage token
  (the Stage-B repro `ччсапп`) is now rejected with a provider-specific structured
  issue (`custom` + `params.shape`) — enforced identically at the api DTO boundary
  and in the admin form. Previously-accepted free-token references no longer
  validate, hence the major bump.

### Patch Changes

- [#669](https://github.com/doctor-school/ds-platform/pull/669) [`af1aa1e`](https://github.com/doctor-school/ds-platform/commit/af1aa1e7d6a110f97b9cdbc1eb786b50f9c25ef5) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add a one-click «← К списку мероприятий» back-to-list affordance to every inner
  admin screen (create + edit), so the operator is never stuck in a navigation
  dead-end from the event page (Stage-B feedback on [#660](https://github.com/doctor-school/ds-platform/issues/660)). Adopts the owned
  `@ds/design-system` `Link` primitive (token-only, blue.700), copy via the RU
  catalog.
- Updated dependencies [[`774f018`](https://github.com/doctor-school/ds-platform/commit/774f01864032e0f95d5f11d56ec7e784ebc8d70a), [`70f5e3e`](https://github.com/doctor-school/ds-platform/commit/70f5e3e80c90a1738096c2909165a682dd6ee9c7), [`67b3da5`](https://github.com/doctor-school/ds-platform/commit/67b3da505dcfc35fac2b7ba7dd13e6d8d0bcec1e), [`ce4b05d`](https://github.com/doctor-school/ds-platform/commit/ce4b05dd06d5d0c2ed39e04b87f7cca2d396185b), [`1547fa4`](https://github.com/doctor-school/ds-platform/commit/1547fa4afa1ffcf84290e28a9b2eef368743763c), [`31b97f2`](https://github.com/doctor-school/ds-platform/commit/31b97f246adfad18d56c336a6559234b1a26c26a), [`e3ce9eb`](https://github.com/doctor-school/ds-platform/commit/e3ce9eb7780d283d52e32321e1fc145ec1720981), [`59bbc2e`](https://github.com/doctor-school/ds-platform/commit/59bbc2ed5ff990402c97f755b230a03696c84ff3), [`f20f1da`](https://github.com/doctor-school/ds-platform/commit/f20f1da596fce75b03c6696b968e52f95566934c), [`b46b15a`](https://github.com/doctor-school/ds-platform/commit/b46b15ad2e7b37d0129db0461240979544438c10), [`2993933`](https://github.com/doctor-school/ds-platform/commit/29939330ee4c3e904842e699e512fe632d8deb9f), [`1b80b39`](https://github.com/doctor-school/ds-platform/commit/1b80b39a7e69c490425d96fd0eedab1bb63d24e7), [`c99ba53`](https://github.com/doctor-school/ds-platform/commit/c99ba534eb7b7e3b1816b43baa7b645edec98550), [`074d2e7`](https://github.com/doctor-school/ds-platform/commit/074d2e78c828fe86687c31038ed61e7285e681d9), [`ae1465d`](https://github.com/doctor-school/ds-platform/commit/ae1465d24c3aa4e9cabe13e8f5036bebb3852180), [`bac9f1e`](https://github.com/doctor-school/ds-platform/commit/bac9f1eaceca4fb20da17b4e1bdba5fe8effdd66), [`05f0964`](https://github.com/doctor-school/ds-platform/commit/05f0964d92f288ba58e05364e82ae01076afb9e2), [`da579b0`](https://github.com/doctor-school/ds-platform/commit/da579b0450b90ea48e40c37f5c7051b3e32e6f75), [`6bdb1c3`](https://github.com/doctor-school/ds-platform/commit/6bdb1c308506b5a5394cfa38fb6c7fd600a4e87a), [`c959008`](https://github.com/doctor-school/ds-platform/commit/c9590083f62c08b274311dbfe101ba914425d873), [`9d5fc7c`](https://github.com/doctor-school/ds-platform/commit/9d5fc7c14cc44a0e4db071329e8581ddc3d5a211)]:
  - @ds/design-system@0.8.0
  - @ds/schemas@1.0.0
