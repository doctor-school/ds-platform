# @ds/admin

## 0.7.0

### Minor Changes

- [#1379](https://github.com/doctor-school/ds-platform/pull/1379) [`717921a`](https://github.com/doctor-school/ds-platform/commit/717921ab7da5745cff5f833bbbc049736b6a96d3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-2 — expert authoring vertical ([#1284](https://github.com/doctor-school/ds-platform/issues/1284))

  Additive across four packages, no breaking change to an existing export; the
  slice consumes the W1a ([#1283](https://github.com/doctor-school/ds-platform/issues/1283)) taxonomy foundation byte-for-byte rather than
  forking it.

  - `@ds/db`: the `experts` entity — slug grammar CHECK, canonical-UUID
    exclusion, the set-once `first_published_at` trigger, a tombstone-ready
    `content_removed_at` column, the `experts_audit` mirror and a `pg_trgm` GIN
    index over `name`/`slug` for operator search.
  - `@ds/schemas`: expert DTOs (create/update/list/detail), the shared
    `expertInitials` derivation and the 012 error codes the surface can raise.
  - `@ds/api`: `GET/POST /v1/admin/experts` and `GET/PATCH /v1/admin/experts/:id`
    — multipart `photo` through the shared still-image normalizer, fenced
    idempotency, ETag/If-Match concurrency, RFC 7807 problems and audit writes.
  - `@ds/admin`: the `experts` resource — list on the shared taxonomy list shell,
    tabbed create/detail with «Основное», the generated-slug preview and the
    deterministic-initials `Avatar` fallback when an expert has no photo. The
    data provider now dispatches its media part off a resource map instead of a
    hardcoded `projects` branch.

### Patch Changes

- [#1387](https://github.com/doctor-school/ds-platform/pull/1387) [`b4a7821`](https://github.com/doctor-school/ds-platform/commit/b4a7821d2e3d191f406579be6eeeb95972b73cd3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Admin list surfaces stop clipping at phone widths. The admin chrome row (brand + nav + sign-out) now wraps below the `sm` breakpoint instead of forcing the page ~113px wider than a 390px viewport — which cut off «Выйти» and, because a horizontal swipe panned the whole page, made the events table's own scroll wrapper unreachable, so «Дата» / «Статус» / «Действия» read as clipped. The list headings on `/events` and on the shared taxonomy list shell also stack above their «Создать …» button at the same breakpoint, instead of the button overlapping the description text. Desktop rendering is unchanged.

- [#1400](https://github.com/doctor-school/ds-platform/pull/1400) [`bebf510`](https://github.com/doctor-school/ds-platform/commit/bebf510ff94062d74689cf386c847ce96a5c24ec) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The admin event screen at `/events/<id>` stops clipping at phone widths. Its header kept the pre-[#1387](https://github.com/doctor-school/ds-platform/issues/1387) single-row `justify-between`, so the event title block and the lifecycle state badge stayed side by side at every width and a realistic (long) title pushed the badge past a 390px viewport. The badge now stacks under the title below the `sm` breakpoint, matching the list surfaces. Desktop rendering is unchanged.

- [#1408](https://github.com/doctor-school/ds-platform/pull/1408) [`1c7c856`](https://github.com/doctor-school/ds-platform/commit/1c7c856a177f1592d3e781ba2a4390a5eec74e48) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Pin `next` to 16.3.0 in the portal and admin apps. Next 16.3.1 bumps its `@swc/helpers`
  dependency to 0.5.23, whose export map adds a `module-sync` condition that Node ≥22.10
  honours in `require()` — the runtime then resolves `@swc/helpers/_/*` to `esm/*.js`, while
  Next's output-file tracing still copies only the `cjs/*.cjs` variants into
  `.next/standalone`. The standalone production images therefore crash-loop at boot with
  `MODULE_NOT_FOUND` before serving a single request.
- Updated dependencies [[`74a1731`](https://github.com/doctor-school/ds-platform/commit/74a173134347ad1bafad8b54e3e16d62a4d8ec33), [`717921a`](https://github.com/doctor-school/ds-platform/commit/717921ab7da5745cff5f833bbbc049736b6a96d3)]:
  - @ds/schemas@3.0.0
  - @ds/design-system@5.0.0

## 0.6.0

### Minor Changes

- [#1356](https://github.com/doctor-school/ds-platform/pull/1356) [`fde1591`](https://github.com/doctor-school/ds-platform/commit/fde1591457f63310d24ad5867b08695c7c263da2) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 012 EARS-1 — project authoring vertical ([#1283](https://github.com/doctor-school/ds-platform/issues/1283))

  Additive across five packages, no breaking change to an existing export:

  - `@ds/db`: the `projects` entity, the extended retained `idempotency_keys`
    contract and `media_cleanup_jobs`, all with DB-enforced retained lifecycles.
  - `@ds/schemas`: taxonomy DTOs, the exact 012 `errorCode` set, the idempotency /
    ETag protocol helpers and the shared canonical slugifier.
  - `@ds/api`: `GET/POST /v1/admin/projects`, `GET/PATCH /v1/admin/projects/:id`,
    the fenced idempotency service, the shared still-image normalizer and the
    durable media-cleanup worker; the object-storage port gains an opt-in
    write-once PUT.
  - `@ds/design-system`: two new primitives — `Textarea` (with a
    no-truncation character counter) and `MediaDropzone`.
  - `@ds/admin`: the shared taxonomy admin list shell and the tabbed project
    detail/create surfaces.
  - `@ds/showcase`: catalogue entries for the two new primitives.

### Patch Changes

- Updated dependencies [[`fde1591`](https://github.com/doctor-school/ds-platform/commit/fde1591457f63310d24ad5867b08695c7c263da2)]:
  - @ds/schemas@2.3.0
  - @ds/design-system@4.2.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`e556fbf`](https://github.com/doctor-school/ds-platform/commit/e556fbfd119d19f5940a5f4dc83aec0501359cd7)]:
  - @ds/design-system@4.1.0

## 0.5.0

### Minor Changes

- [#1220](https://github.com/doctor-school/ds-platform/pull/1220) [`15c586a`](https://github.com/doctor-school/ds-platform/commit/15c586aa0184d17a3d581e65b4acf09b2c0d1c05) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - The admin login screen now tells an operator the truth when the identity service is
  down. A 503 from `POST /v1/admin/auth/login` renders a warning alert («Сервис входа
  временно недоступен…») instead of the wrong-credentials verdict, keeps the typed
  email and password (they were never checked) and leaves the submit button active.
  The uniform 401 refusal and the 429 throttling message are unchanged.

- [#1215](https://github.com/doctor-school/ds-platform/pull/1215) [`dd4868e`](https://github.com/doctor-school/ds-platform/commit/dd4868e4acf90eed9e52d7719384f8372942a3b8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Admin MFA screens now tell an operator the truth when the IdP is down. A 503 from
  `mfa/enroll/start`, `mfa/enroll/verify` or `mfa/verify` renders a warning alert
  («Сервис проверки кода временно недоступен…») instead of the wrong-code verdict,
  keeps the typed code and leaves the submit button active, and — on the enrollment
  offer — no longer bounces the operator to `/login`. The uniform 401 refusal and the
  429 throttling message are unchanged.

## 0.4.0

### Minor Changes

- [#1207](https://github.com/doctor-school/ds-platform/pull/1207) [`d6b365f`](https://github.com/doctor-school/ds-platform/commit/d6b365fbeb28732c2b561f78b420ea060e96970b) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 011 EARS-4/5 — forced-enrollment gate + self-serve TOTP enrollment.

  A `platform_admin` who completes primary auth with no registered TOTP factor is
  now held in `mfa_pending_enrollment`: the API refuses every admin route for that
  state and admits only the two enrollment endpoints, and the admin app renders the
  enrollment screen — QR, the same secret as selectable text, and a six-digit code
  field. A correct first code registers the factor, appends a secret-free
  `auth.mfa.enrolled` row, and upgrades the pending authentication in place into
  `__Host-ds_admin_session`, so the operator lands in admin with no second login.

  Additive: `POST /v1/admin/auth/mfa/enroll/{start,verify}`, the `IdpPort` TOTP
  register/verify seam, the enrollment schemas, and the `pending-auth`
  endpoint-authz access class.

- [#1210](https://github.com/doctor-school/ds-platform/pull/1210) [`40f50a8`](https://github.com/doctor-school/ds-platform/commit/40f50a8d316a17b00642d78de8bc64439ab0464d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 011 EARS-6/7 — TOTP challenge on admin login, with the ADR-0001 §7 failure discipline behind it.

  An enrolled `platform_admin` completing primary auth at the admin origin is now presented a TOTP challenge, and `POST /v1/admin/auth/mfa/verify` is the only thing that turns their pending authentication into `__Host-ds_admin_session` — verified against the IdP session itself, single-use within its window, with nothing on the admin surface reachable in between. A new `GET /v1/admin/auth/state` read reports where a browser sits in that flow (the enum and nothing else — no budget, no lock, no subject), which is what the admin app routes on now that the cookies carrying the answer are `HttpOnly`.

  Failed verifications on **both** the enrollment and challenge surfaces now count against the shared per-user/per-IP budgets, append an `auth.mfa.failure` row, and soft-lock the account at the §7 threshold with an `auth.lockout.triggered` row and an email notice — a locked account is refused even on a correct code, and every refusal stays one uniform message.

  `apps/admin` moves off the doctor-portal session onto the admin tier end to end: login → challenge or enrollment → admin, admin writes carrying the CSRF double-submit header, and the new RU challenge screen. Both code screens now disable their submit control until six digits are present, so a cleared field after a failed code no longer leaves a button that looks live and cannot act.

### Patch Changes

- Updated dependencies [[`823f0d3`](https://github.com/doctor-school/ds-platform/commit/823f0d319994754e6eb24092508ff5c76189cb88), [`d6b365f`](https://github.com/doctor-school/ds-platform/commit/d6b365fbeb28732c2b561f78b420ea060e96970b), [`40f50a8`](https://github.com/doctor-school/ds-platform/commit/40f50a8d316a17b00642d78de8bc64439ab0464d), [`2114512`](https://github.com/doctor-school/ds-platform/commit/2114512b17822587280804a012b875e1512d4343)]:
  - @ds/schemas@2.2.0
  - @ds/design-system@4.0.2

## 0.3.0

### Minor Changes

- [#1154](https://github.com/doctor-school/ds-platform/pull/1154) [`7355ade`](https://github.com/doctor-school/ds-platform/commit/7355adea6c7d76b471deecdee774f339ce049750) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Add VK Video and CDNVideo to the webinar stream-provider enum end-to-end ([#1134](https://github.com/doctor-school/ds-platform/issues/1134)).

  The closed `STREAM_PROVIDERS` enum grows from `rutube | youtube` to
  `rutube | youtube | vk | cdnvideo` (all RU-reachable, embeddable providers),
  additively across every layer that reads the SSOT:

  - `@ds/schemas` — per-provider `EMBED_REF_SHAPES`: VK's `oid_id_hash` triple (the
    hash is mandatory and non-derivable) and CDNVideo's host-allowlisted player URL
    (`playercdn.cdnvideo.ru/aloha/players/`, an SSRF guard on the value the room
    drops into its `<iframe src>`). CDNVideo is the recorded stored-URL exception; the
    URL-shaped-paste guard is now provider-scoped so the id-style providers still
    reject a link.
  - `@ds/db` — the Postgres `stream_provider` enum gains `vk` + `cdnvideo` via an
    additive `ALTER TYPE … ADD VALUE` migration.
  - `@ds/portal` — the room resolves the VK `video_ext.php` embed from the triple and
    embeds the CDNVideo player URL verbatim; a provider-scoped direct watch URL is
    derived per provider.
  - `@ds/admin` — ConfigureStream offers all four providers with a per-provider embed
    reference hint and provider-named RU validation errors.

### Patch Changes

- Updated dependencies [[`88bc412`](https://github.com/doctor-school/ds-platform/commit/88bc412cb3620e83202979c9026e8505d3a696d1), [`7355ade`](https://github.com/doctor-school/ds-platform/commit/7355adea6c7d76b471deecdee774f339ce049750)]:
  - @ds/schemas@2.1.0
  - @ds/design-system@4.0.1

## 0.2.10

### Patch Changes

- Updated dependencies [[`326df3c`](https://github.com/doctor-school/ds-platform/commit/326df3cce477af6792d9f282e594888784cab69a), [`807887e`](https://github.com/doctor-school/ds-platform/commit/807887e60668264b467e943f61d2e7e30ebbb335)]:
  - @ds/schemas@2.0.0
  - @ds/design-system@4.0.0

## 0.2.9

### Patch Changes

- Updated dependencies [[`f09fecd`](https://github.com/doctor-school/ds-platform/commit/f09fecd905942d611f80717fdf69c465d4efa244)]:
  - @ds/design-system@3.1.0

## 0.2.8

### Patch Changes

- Updated dependencies [[`62892f6`](https://github.com/doctor-school/ds-platform/commit/62892f683c34885bb02b760480f4fb68b0283c7e), [`c717a70`](https://github.com/doctor-school/ds-platform/commit/c717a70e3c587ffbec36239bc030d64dc724f765)]:
  - @ds/design-system@3.0.0

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
