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

## The «now» the dataset is built around

Every timestamp in the dataset is derived from one instant via `shiftFromNow`,
and by default that instant is **the seed run time**. No row relies on a
`defaultNow()` column default — `created_at` / `updated_at` are written
explicitly, all from the same resolved «now», so the whole scenario moves as one
piece.

The run time is the default because the stand's apps read the real clock. A
dataset frozen at a literal date turns «Предстоящий эфир» into a past event the
moment the calendar passes it, and «Расписание эфиров» on the slot renders empty
(#2212). Re-running the seed moves the schedule forward: the upsert refreshes
every date-bearing column of the rows it already wrote (see «Idempotency and the
build»).

Publication instants are the one exception. `first_published_at` is set once by
the `taxonomy_first_published_at_set_once` trigger (migration 0015): an UPDATE
that moves or clears it raises a `check_violation`. A slot database is cloned
from `ds_golden`, so those rows arrive already published — a re-run therefore
keeps the instant of the first build and refreshes every other date. A
from-scratch `ds_golden` build starts from an empty database, so its inserts
write the instants at its own run time.

`GOLDEN_NOW` pins the instant explicitly (strict ISO-8601 UTC with millisecond
precision; a `2026-01-15` or a `+03:00` offset is refused rather than silently
reinterpreted — a malformed pin fails the seed, it never falls back to the
clock). The pin is the reproducibility tool: the unit suite pins it so the
dataset assertions stay deterministic, and the drift check below runs **both**
builds under the same pin.

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

### The volume half

The named rows above prove that every state _exists_. They do not make a stand
look like the product, and a walk against one row per state cannot see a
pagination defect, an empty cell in a week view, a month view with a single
point, or a list that sorts fine at n=1. Production data never reaches the
staging box (152-ФЗ), so the **shape** of this dataset is the only substitute
for it.

`volume.ts` therefore appends a second half at every rebuild — same builder,
same pin, ordinals ≥ `GOLDEN_VOLUME_ORDINAL_BASE` (1000) in every id group, so
the named catalogue keeps its ids, its offsets and its position in each array.
`isGoldenVolumeUuid(id)` answers «is this a volume row?» from the id alone.

| Family               | Volume rows | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`             | 55          | 17 `published` upcoming: one per ISO week for 16 weeks (≈4 calendar months) plus one **сегодня**, six hours out, which is both a schedule state of its own and the row that keeps the CURRENT month non-empty when the seed runs near a month end · 2 `live` · 3 `draft` · 3 `hidden` · 22 `ended` back to −197d (15 with a recording, of which 3 are still a draft montage; 7 with none) · 8 `in_archive` with `origin = legacy` and a published recording each, back to −385d. Mixed `online`/`offline`/`hybrid`; one offline event in eleven is sold out (`seats_left = 0`). |
| `experts`            | 32          | all `published` with `first_published_at`; each carries `photo_ref` (a committed portrait — «Media» below), a 2–3 sentence `bio`, `credentials` (степень / звание / категория), `affiliation` and `professional_role`; each linked to ≥6 events                                                                                                                                                                                                                                                                                                                                 |
| `projects`           | 12          | `school` and `media` mixed, all published, each with a two-paragraph description; each on ≥4 events                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `event_experts`      | 2–4/event   | co-prime strides over the expert list, deduped, positions 0…3; roles `Спикер` / `Модератор` / `Эксперт`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `event_projects`     | 1–2/event   | co-prime strides over the project list, deduped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `users`              | 13          | 8 verified · 3 unverified · 2 retired (`deleted_at` + `deactivated_at`) — all `doctor_guest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `registrations`      | 46          | 39 generated (3 per volume doctor on co-prime slots, past and future; 1 in 7 `retired` + `deleted_at` = a cancellation) + 7 extra for the two IdP-backed named doctors, so «мои эфиры» is walkable as a real signed-in user. Slots cover only `published`/`live`/`ended` эфиры — the product refuses a `draft` or `hidden` one — and `registered_at` is derived from the event's own offset, so it always precedes both the эфир and «now»                                                                                                                                      |
| `event_recordings`   | 32          | 20 `published` · 8 `draft` · 4 `retired`; `edited` and `raw` both present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `stream_config`      | 17          | the 2 live and the 15 recorded ended events; never on a `legacy` archive row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `consent_records`    | 39          | the same 3 purposes × 13 doctors as the named rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `doctor_specialties` | 13          | one primary specialty per volume doctor, names from the closed Минздрав book                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Design rules this half obeys, each locked by a `#2213:` test in `golden.spec.ts`:

1. **Append, never renumber.** A scenario compiled against a named id sees
   exactly what it saw before the volume half existed.
2. **Deterministic without a random source.** No `Math.random`, no faker, no
   `new Date()` — rows are index-driven plans over curated literal lists and
   every instant is `shiftFromNow(now, …)`. Same pin ⇒ same bytes.
3. **Product-like text.** Russian titles, names and specialties from a curated
   programme. «Event 17» would make an operator walk unreadable and would hide
   the text-length problems a real catalogue has. The banks live in
   `content.ts`: 133 titles across 14 specialties of the Минздрав book, 6
   paragraphs per specialty plus 8 shared format/НМО paragraphs, 32 expert
   specs and 12 projects. `composeDescription(i, specialty)` assembles 3–5
   paragraphs (101–247 words per эфир) from those banks by index alone, so
   neighbouring cards never repeat and no description is a single line — the
   shape PR #2216 was rejected for. `durationMin` is not invented either: it is
   the sum of the эфир's own programme (115–185 min), so the card, the page and
   the downloadable programme agree.
4. **Floors, not censuses.** The tests assert minimums (≥48 events, >20
   archive-visible rows, gap-free 16-week coverage, each of the previous 6
   months, ≥2 doctors per state …). Add rows freely; raising a floor means
   adding the rows _and_ the assertion in the same PR, never relaxing one.
5. **No IdP account.** Volume doctors carry a synthetic
   `zitadel_sub = golden-volume-<ordinal>` and exist to populate rosters, lists
   and admin tables. Only a doctor a scenario signs _in_ as needs a real
   Zitadel account, and those are the five named ones above — so `volume.ts`
   never touches `idp.ts` or the box's provisioning path.
6. **Only shapes the product itself can produce.** The dataset is a substitute
   for production data, so it never holds a row the platform would refuse to
   write: an `in_archive` эфир always carries a published recording (014
   EARS-25 offers that transition only then), `recording_expected_by` is set on
   exactly the ended эфиры with no published recording — the only rows where the
   dated «запись готовится» plaque is projected, half of them still ahead of the
   pin and half already overdue — and a registration exists only on an эфир a
   doctor could have registered for, always before it started.
7. **Set-once instants stay set-once.** The volume half multiplies the rows
   carrying `first_published_at`; the upsert still writes it on insert and never
   on update, or the `taxonomy_first_published_at_set_once` trigger rolls the
   whole re-seed back.

### Media

A catalogue of эфиры without a single speaker photo and without a single
programme is not the product: the doctor page renders a portrait next to every
speaker and a «Скачать программу» download when `events.program_pdf_ref` is set.
Rows alone cannot make those surfaces real, so the seed writes objects too.

| Key                                     | Content type      | Count | Source                                           |
| --------------------------------------- | ----------------- | ----- | ------------------------------------------------ |
| `golden/experts/<ordinal>.webp`         | `image/webp`      | 34    | committed file, `media/portraits/<ordinal>.webp` |
| `golden/events/<ordinal>/programme.pdf` | `application/pdf` | 46    | rendered at seed time from the эфир's own rows   |

`<ordinal>` is the same ordinal the row's UUID is derived from (`ids.ts`), so a
key is reconstructible from an id and nothing needs a lookup table. Both named
experts get a portrait too; their ids, slugs and every other column stay
byte-identical.

**Portraits.** The 34 committed WebP files are **synthetic faces** produced by a
StyleGAN2-class generator (`thispersondoesnotexist.com`) — no real person, no
model release to chase, no stock licence to track. Each was normalised once, by
hand, to 512×512 WebP (`ffmpeg` + `libwebp`, quality 80, generator watermark
cropped before the resize) and is ≤25 KB; the whole set is well under a
megabyte. They are read with `fs.readFile` relative to `import.meta.url`, which
is correct because `seed:golden` always runs from source (`tsx
src/seed/golden/run.ts` inside the `migrate` one-shot). A consumer that ran a
compiled `dist` copy would get a loud `ENOENT` rather than a silent skip — the
right failure for a fixture that is supposed to be complete.

**Programmes.** Nothing is committed: each PDF is rendered at seed time by
`renderProgrammePdf` (`pdf-lib` + `@pdf-lib/fontkit`) over the two committed
Inter faces in `media/fonts/` (`Inter-Regular.ttf`, `Inter-SemiBold.ttf`, SIL
Open Font License 1.1, `OFL.txt` alongside them). The document is derived from
the эфир's own rows — title, date and time МСК, format, the timed sessions from
`programme.ts`, each named speaker with the role that row actually gives them, a
«Вопросы и ответы» block and the sponsoring project from the event's first
`event_projects` link — so a programme can never name a speaker the page does
not list. The bytes are deterministic: fixed `CreationDate` / `ModDate`, fixed
Producer and Creator, no generated `/ID`, fonts embedded unsubsetted. Two builds
at the same `GOLDEN_NOW` produce identical bytes; two builds at different pins
differ only in the dated lines. Coverage follows a pure ordinal rule — every
`published` / `live` / `ended` / `in_archive` volume эфир carries one except 3
of the 17 upcoming ones (46 of 49 eligible rows, ~94 %), which keeps the
«программа готовится» plaque on the page walkable. `draft` and `hidden` эфиры
carry none.

**Where the objects go.** `seedGolden(db, { media })` takes a
`GoldenMediaStore { exists, put }`; the unit suite injects
`createInMemoryGoldenMediaStore()`, and `run.ts` builds an S3 store from
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_UPLOADS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
(`S3_FORCE_PATH_STYLE` defaults on, for MinIO). A missing variable **refuses the
run** and names every missing one at once, exactly like the `DATABASE_URL`
check: there is no skip flag and no fake store on the production path, because a
seed that quietly wrote rows pointing at objects nobody uploaded is worse than a
seed that failed. The per-slot bucket and this environment are wired by #2223.

**Idempotency.** The plan is pure — a list of `{key, contentType, bytes}` built
from the dataset at the pin — and the writer PUTs only the keys `exists()`
reports absent, eight at a time. A re-seed of an unchanged template therefore
writes 0 objects, and the media half obeys the same «a second run changes
nothing observable» rule as the rows. Media is written **before** the row
transaction: a failed upload aborts the seed with no rows referring to a missing
object.

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

`seed:golden` upserts every row on its fixed UUID inside **one** transaction,
refreshing every column it wrote except the set-once publication instants. A
second run under the same `GOLDEN_NOW` therefore changes nothing observable; a
second run without a pin rewrites exactly the time-derived columns it is allowed
to move and leaves every id, slug, relation and `first_published_at` alone —
that is how the slot's schedule stays in the future. All-or-nothing, because a
half-written template that still looks buildable would be inherited by every slot
cloned from it.

`tools/staging/golden-db.mjs` never migrates in place. It builds
`ds_golden_next` beside the live template, and only after the migrate and the
seed both succeeded does it rotate `ds_golden → ds_golden_prev → dropped` and
`ds_golden_next → ds_golden`. One previous generation is kept. A failed build
leaves `ds_golden` serving the previous generation untouched.

## Drift rule (§9)

Two consecutive template builds **run under the same explicit `GOLDEN_NOW` pin**
must produce an empty `pg_dump --data-only` diff, over every table except the two
bookkeeping tables named below. Without a pin the two builds differ in exactly
the time-derived columns, which is now the intended behaviour — so the drift
check supplies one.

The seed step runs as a one-shot in the slot's `migrate` container (the box has
no host `pnpm`, §3 «Host runtime»), which is where the pin is injected:

```sh
PIN=2026-01-15T12:00:00.000Z
EXCL='--exclude-table=__drizzle_migrations --exclude-table=audit_ledger'
SEED="docker compose --profile migrate run --rm \
  -e DATABASE_URL=$DATABASE_URL_GOLDEN -e GOLDEN_NOW=$PIN migrate \
  pnpm --filter @ds/db run seed:golden"

$SEED
pg_dump --data-only --no-owner $EXCL "$DATABASE_URL_GOLDEN" > /tmp/golden-1.sql
$SEED
pg_dump --data-only --no-owner $EXCL "$DATABASE_URL_GOLDEN" > /tmp/golden-2.sql
diff /tmp/golden-1.sql /tmp/golden-2.sql   # must be empty
```

The comparison excludes exactly two tables — `__drizzle_migrations` and
`audit_ledger` — and no others. Neither holds dataset content: each records the
fact and the moment of a write, so its rows carry per-build ids and timestamps by
design. Every one of the 22 dataset tables is compared in full, column for
column. A non-empty diff under a fixed pin means something in the dataset read
the clock on its own, generated an id, or relied on a column default — fix the
dataset, never the diff.

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
- **Timestamps follow the golden «now».** `seedGolden` passes the resolved `now`
  to the book seed, so `created_at` / `updated_at` move with the run time — or
  with `GOLDEN_NOW` when one is pinned — like every other golden timestamp.
  Without that argument — the API boot path — the database clock still decides,
  exactly as before.

A re-seed of unchanged data therefore writes nothing at all: the frequent-rank
pre-clear skips rows that already hold the rank they are about to be given, and
the conflict branch moves `updated_at` only when `name`, `is_other` or
`frequent_rank` really differs from the stored row.

No column of any dataset table is excluded from the comparison. Scenarios must
still address specialties by code or name rather than by a hard-coded id: the id
belongs to the book seed, and a scenario that pins one would break on any
database whose book predates the derivation.

### `audit_ledger` — build bookkeeping, not dataset content

The dataset is written with `source: db-direct`, and the audit trigger records
every one of those inserts — the named catalogue and the volume half alike. Those ledger rows are _derived_: their whole payload
(`metadata.diff`, `metadata.pk`, `event_type`, `table`) is a function of the
golden rows and is byte-identical between builds. What is not identical is the
ledger's own write-provenance — `id`, `event_id`, `created_at` and
`metadata.txid` — because an audit row truthfully records _when a write actually
happened_, and pinning that would falsify the record.

So a raw two-build diff is empty on all 22 dataset tables and non-empty on
`audit_ledger` alone, in those four columns. `audit_ledger` sits in the same
class as `__drizzle_migrations`: bookkeeping about the build rather than fixture
content.

**The rule.** The drift comparison skips `audit_ledger`, exactly as it already
skips `__drizzle_migrations` — those two tables and no others. The golden build
does **not** truncate the ledger and does **not** disable the trigger: the ledger
stays a faithful record of the template build, and a cloned preview slot inherits
the seed's own audit rows. Those rows are expected, not drift. Excluding the
table from the diff is what keeps the rule honest — the alternative, pinning
`id` / `event_id` / `created_at` / `metadata.txid`, would falsify a record whose
only job is to say when a write really happened.
