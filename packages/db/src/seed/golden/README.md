# Golden dataset (`ds_golden`)

The deterministic fixture the staging box's regression contour runs against
(Issue #2063; tech spec `apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md`
§4, §8 step 3, §9 «Golden seed drift»).

A per-PR preview slot is a **clone** of the `ds_golden` template database, so the
template is the single point where fixture quality is decided. Everything below
exists to keep two builds of that template byte-identical.

## Commands

| Command                            | Effect                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm seed:golden`                 | Writes the golden dataset into `DATABASE_URL`, idempotently.                          |
| `pnpm staging:golden-db`           | Rebuilds the `ds_golden` template: create `ds_golden_next` → migrate → seed → rotate. |
| `pnpm staging:golden-db --dry-run` | Prints the SQL and commands without touching the server.                              |
| `pnpm --filter @ds/db test`        | The pure core (pin, identities, dataset, plan).                                       |
| `pnpm test:tools`                  | The template-build seams (`tools/staging/golden-db.test.mjs`).                        |

`DATABASE_URL` is read from the box environment (locally:
`~/.ds-platform/.env.local`). Never hardcode an endpoint.

Production seeds nothing. `pnpm seed:golden` is a staging-only step and is
deliberately not wired into `tools/deploy/prod.mjs`.

## The pinned «now»

Every timestamp in the dataset is derived from one instant,
`GOLDEN_NOW_DEFAULT = 2026-01-15T12:00:00.000Z`, via `shiftFromNow`. Nothing
reads the wall clock and no row relies on a `defaultNow()` column default —
`created_at` / `updated_at` are written explicitly. That is what makes
`pg_dump --data-only` of build _N_ and build _N+1_ identical.

Override with `GOLDEN_NOW` (strict ISO-8601 UTC with millisecond precision; a
`2026-01-15` or a `+03:00` offset is refused rather than silently reinterpreted).
The drift check runs two builds and diffs the dumps — a difference that is not
explained by a changed `GOLDEN_NOW` is a defect in the dataset, not in the box.

## Identity-provider accounts

The seed **never creates IdP users**. A seed that invents passwords either
commits them (a leak) or discards them (an account nobody can sign in as). The
accounts are provisioned by the box's `infra/dev-stand/idp` converge; the seed
asserts they exist by requiring their subject ids in the environment and refuses
to run otherwise, naming every missing variable at once.

| Catalogue key      | Username                                | `users.role`     | Email verified | MFA at IdP | Subject id                        | Password                               |
| ------------------ | --------------------------------------- | ---------------- | -------------- | ---------- | --------------------------------- | -------------------------------------- |
| `doctorUnverified` | `golden.doctor.unverified@example.test` | `doctor_guest`   | no             | no         | `DS_GOLDEN_SUB_DOCTOR_UNVERIFIED` | `DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED` |
| `doctorVerified`   | `golden.doctor.verified@example.test`   | `doctor_guest`   | yes            | no         | `DS_GOLDEN_SUB_DOCTOR_VERIFIED`   | `DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED`   |
| `doctorMfa`        | `golden.doctor.mfa@example.test`        | `doctor_guest`   | yes            | yes        | `DS_GOLDEN_SUB_DOCTOR_MFA`        | `DS_GOLDEN_PASSWORD_DOCTOR_MFA`        |
| `doctorDeleted`    | `golden.doctor.deleted@example.test`    | `doctor_guest`   | yes            | no         | `DS_GOLDEN_SUB_DOCTOR_DELETED`    | `DS_GOLDEN_PASSWORD_DOCTOR_DELETED`    |
| `admin`            | `golden.admin@example.test`             | `platform_admin` | yes            | yes        | `DS_GOLDEN_SUB_ADMIN`             | `DS_GOLDEN_PASSWORD_ADMIN`             |

Values live in the box environment only; nothing here is committed. The seed
reads the subject columns; the password variables are the scenario runner's
input (step 7) and are catalogued here so golden credentials have one home.

`doctorDeleted` has **no live IdP account** — the platform row is soft-deleted.
Its subject id is still declared because `users.zitadel_sub` is `NOT NULL` and
must stay stable across rebuilds; any stable opaque string does.

MFA has no column. It is an IdP property, so the MFA-enrolled doctor's mirror row
is indistinguishable from a plain verified doctor — a scenario proves MFA by
signing in, not by reading `users`.

## Dataset catalogue

Addressed through the exported `golden` object (`packages/db/src/seed/golden/ids.ts`);
step 7's `route-params.ts` imports it. These names are a published contract.

Import it from the dedicated subpath, `import { golden } from "@ds/db/seed/golden"`.
It is deliberately absent from the `@ds/db` root barrel: the api imports that
barrel for the specialty book seed, and a staging fixture — accounts, events,
consent records — has no business in the production module graph.

| Path                                         | Row                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `golden.doctors.unverified`                  | signed up, address unconfirmed                                            |
| `golden.doctors.verifiedCardiologist`        | the default doctor; primary specialty «Кардиология»                       |
| `golden.doctors.mfaEnrolled`                 | verified + second factor; primary specialty «Неврология»                  |
| `golden.doctors.deleted`                     | `record_status = 'retired'`, `deleted_at` stamped                         |
| `golden.admins.platform`                     | the `platform_admin`                                                      |
| `golden.experts.published` / `.draft`        | published expert (on three events + curator of the school) / draft expert |
| `golden.projects.publishedSchool` / `.draft` | published `school` / draft `media`                                        |
| `golden.events.draft`                        | `draft`                                                                   |
| `golden.events.upcoming`                     | `published`, starts `+14d`, seats left — the registration happy path      |
| `golden.events.live`                         | `live`, started `-15m`, `live_at` stamped, `stream_config` attached       |
| `golden.events.hidden`                       | `hidden`                                                                  |
| `golden.events.pastWithRecording`            | `ended` at `-30d`, carries the recordings below                           |
| `golden.events.archived`                     | `in_archive`, `origin = legacy`                                           |
| `golden.recordings.pastEdited`               | published edited recording (poster + duration)                            |
| `golden.recordings.pastRawDraft`             | draft raw recording — admin-only                                          |
| `golden.registrations.*`                     | verified doctor on upcoming / live / past; MFA doctor on live             |

Identities are literal (`ids.ts`), never generated: a scenario compiled against
`golden.events.live.id` must address the same row in every slot and every
rebuild. Slugs are `golden-*`.

### Two recorded deviations

1. **«Legal documents» are stored as `consent_records`.** There is no
   legal-documents table: legal texts are Fumadocs pages (028), not rows, and
   what the database holds about them is the per-purpose acceptance. The golden
   dataset therefore pins the _acceptances_ — purposes
   `medical-worker-declaration`, `partner-data-sharing`,
   `marketing-communications` at version `2026-01`, for every consenting golden
   doctor. Those strings mirror `DOCTOR_REGISTER_CONSENT_PURPOSES` (021,
   `@ds/schemas`) and are duplicated rather than imported: `@ds/db` sits below
   `@ds/schemas`, and inverting that for three string literals would make the
   data layer depend on the contract layer.
2. **Doctor↔specialty links resolve at seed time.** `specialties_minzdrav.id` is
   owned by the 017 book seed, not by this dataset, so the golden dataset
   references specialties by _name_ and `resolveDoctorSpecialtyRows` maps them to
   ids during the seed. Pinning a specialty UUID here would make the golden seed
   own a value it does not produce — and a database seeded before the book ids
   became derivable still carries random ones. A name the book does not carry
   aborts the seed. The seed runs the (idempotent) book seed in its own
   transaction first, because a freshly migrated template has never booted the
   API that normally seeds it.

## Idempotency and the build

`seed:golden` upserts every row on its pinned identity inside **one**
transaction, refreshing every column it wrote. A second run therefore changes
nothing observable — all-or-nothing, because a half-written template that still
looks buildable would be inherited by every slot cloned from it.

`tools/staging/golden-db.mjs` never migrates in place. It builds
`ds_golden_next` beside the live template, and only after the migrate and the
seed both succeeded does it rotate `ds_golden → ds_golden_prev → dropped` and
`ds_golden_next → ds_golden`. One previous generation is kept. A failed build
leaves `ds_golden` serving the previous generation untouched.

## Drift rule (§9)

Two consecutive template builds must produce an empty
`pg_dump --data-only` diff modulo `GOLDEN_NOW`:

```sh
pnpm staging:golden-db
pg_dump --data-only --no-owner "$DATABASE_URL_GOLDEN" > /tmp/golden-1.sql
pnpm staging:golden-db
pg_dump --data-only --no-owner "$DATABASE_URL_GOLDEN" > /tmp/golden-2.sql
diff /tmp/golden-1.sql /tmp/golden-2.sql   # must be empty
```

A non-empty diff means something in the dataset read a clock, generated an id, or
relied on a column default — fix the dataset, never the diff.

### Why the rule holds on the specialty book too

`seed:golden` runs the 017 book seed itself, so `specialties_minzdrav` is part of
the template and part of the diff. Three properties keep it byte-identical:

- **Ids are derived, not random.** A freshly inserted book row takes
  `uuid_v5(namespace, code)` (`seed/specialty-id.ts`), so a build starting from an
  empty `ds_golden_next` produces the same `specialties_minzdrav.id` — and the
  same `doctor_specialties.specialty_id` — every time.
- **A conflict never rewrites an id.** The upsert's `ON CONFLICT (code)` branch
  sets `name`, `is_other`, `frequent_rank` and `updated_at` only. A live database
  that already handed out random ids keeps them, and every stored reference to a
  doctor's specialty stays valid; the derivation applies to fresh inserts alone.
- **Timestamps are pinned on the golden path.** `seedGolden` passes the pinned
  `now` to the book seed, so `created_at` / `updated_at` move with `GOLDEN_NOW`
  like every other golden timestamp. Without that argument — the API boot path —
  the database clock still decides, exactly as before.

A re-seed of unchanged data therefore writes nothing at all: the frequent-rank
pre-clear skips rows that already hold the rank they are about to be given, and
the conflict branch moves `updated_at` only when `name`, `is_other` or
`frequent_rank` really differs from the stored row.

The diff comparison excludes **no** column. Scenarios must still address
specialties by code or name rather than by a hard-coded id: the id belongs to the
book seed, and a scenario that pins one would break on any database whose book
predates the derivation.
