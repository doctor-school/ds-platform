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

The `users.role` column above is mirrored at the IdP as a project GRANT, and
`ds-slot reset-identities` converges it alongside the password: a created account
is always granted its catalogue role, a live one only when its role keys drift.
An admin account that exists and signs in but holds no `platform_admin` grant is
a green converge and a failed walkthrough, which is why it is asserted and not
assumed.

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

#### The calendar rule

The dataset is not a list of эфиры with dates attached — it is a **season**, and
the season is what the rest of the numbers fall out of. `gridCells` anchors on
the МСК Monday of the pin's own week and lays down weeks **−28 … +18** around it
(a little over ten months, so the archive has depth and «Расписание» has four
months of future to page through). Inside each week:

| Day      | Эфиры                                                      | Time МСК                                                          |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Mon–Fri  | 2 or 3, on the running counter `[2, 3, 2, 3, 3, 2, 3]`     | `13:00`/`16:00` + `19:30`, or `11:00`/`13:00` + `18:00` + `19:30` |
| Saturday | 1, **every** week                                          | `11:00`                                                           |
| Sunday   | the «школа» — one week in four, nothing on the other three | `10:00`                                                           |

Seven cadence entries against five weekdays make the pattern drift instead of
stamping «Monday is always a two-эфир day» into the calendar, and the slot set
alternates on the day counter, so two neighbouring days never look like copies
of each other. Saturday is deliberately weekly rather than fortnightly: every
day the owner opens in «Расписание» has to carry something, and a fortnightly
Saturday leaves half of them blank — the defect the Stage-B walk of PR #2216
found.

Three rows are appended after the grid, in a fixed order so no grid ordinal ever
moves: two `live` rooms (a grid cell is «live» for ninety minutes a week, and the
room happy path has to be reachable at _any_ pin) and one эфир later **today** —
its own schedule state, the badge and the countdown, and the row that keeps «этот
месяц» non-empty on a pin in the last hours of a month.

**State is a function of position, never of a quota.** A cell ahead of the pin is
`published` (with one `draft` and one `hidden` per future month, always on the
first slot of a day that carries two or three, so the doctor still sees a
published эфир there); a cell behind it is `ended`, and the oldest 35 % of the
past is `in_archive`. Seven ended эфиры in ten carry a recording; one recorded
эфир in thirteen is still a draft montage, so the доктор sees the same «запись
готовится» plaque either way.

Every count in the table below is therefore an **output of the rule, not an
input**. Because the grid is anchored on the pin's own Monday, the outputs are
also pin-invariant: 672 эфиров at `2026-01-15T12:00:00.000Z` and 672 at every
other pin the suite replays, with only the per-state split breathing by a row or
two as the week boundary moves.

| Family                  | Rows at the pin   | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`                | 672               | 253 `published` · 263 `ended` · 142 `in_archive` (`origin = legacy`, a published recording each) · 6 `draft` · 5 `hidden` · 3 `live`. 666 of them are volume rows, the other 6 the named catalogue. Formats are evenly mixed (223 `online` · 221 `offline` · 222 `hybrid`); 40 of the room-bound ones are sold out (`seats_left = 0`). 93 ended эфиры carry `recording_expected_by` — the dated «запись готовится» plaque — half of them still ahead of the pin, half deliberately overdue                                                                                    |
| `experts`               | 34                | 32 volume + the 2 named, all `published` with `first_published_at`; each carries `photo_ref` (a committed portrait — «Media» below), a 2–3 sentence `bio`, `credentials` (степень / звание / категория), `affiliation` and `professional_role`                                                                                                                                                                                                                                                                                                                                |
| `projects`              | 14                | 12 volume + the 2 named; `school` and `media` mixed, all published, each with a two-paragraph description                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `event_experts`         | 1 899 (2–4/event) | co-prime strides over the expert list, deduped, positions 0…3; roles `Спикер` / `Модератор` / `Эксперт`, with a `Модератор` on 666 of the 672 эфиры — a panel without a moderator is not the shape the page renders                                                                                                                                                                                                                                                                                                                                                           |
| `event_projects`        | 1 001 (1–2/event) | co-prime strides over the project list, deduped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `users`                 | 18                | 13 volume doctors (8 verified · 3 unverified · 2 retired with `deleted_at` + `deactivated_at`) + the 5 named accounts — all `doctor_guest` except the one `platform_admin`                                                                                                                                                                                                                                                                                                                                                                                                    |
| `registrations`         | 379               | 15 to 40 per verified volume doctor, spread over the WHOLE season (past and future) on a prime stride, so «мои эфиры» paginates and holds a mixed history; the two IdP-backed named doctors hold 12 generated rows each on top of their catalogue ones, short enough to read on one screen. 37 rows (9.8 %) are `retired` + `deleted_at` — the cancellation shape. Slots cover only `published`/`live`/`ended` эфиры (the product refuses a `draft` or `hidden` one), and `registered_at` falls after the HOLDER's own account was created and before both the эфир and «now» |
| `event_recordings`      | 435               | 312 `published` · 77 `draft` · 46 `retired`; 372 `edited` and 63 `raw`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `stream_config`         | 188               | one per эфир that has a room to configure — the live ones and the recorded ended ones; never on a `legacy` archive row                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `consent_records`       | 51                | the same 3 purposes × every consenting doctor, volume and named alike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `doctor_specialties`    | 15                | one primary specialty per doctor, names from the closed Минздрав book                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `directions`            | 41                | 38 `published` · 2 `draft` · 1 `retired` (`deleted_at` stamped) — the authored catalogue in `taxonomy.ts`, wide enough that the 118-name Минздрав book partitions over it                                                                                                                                                                                                                                                                                                                                                                                                     |
| `partners`              | 14                | 11 `published` · 2 `draft` · 1 `retired`; two of them deliberately carry no `website_url` — «партнёр без сайта» is a rendered state of its own — and every one carries a `logo_ref` («Media» below)                                                                                                                                                                                                                                                                                                                                                                           |
| `direction_specialties` | 130               | 126 `active` · 4 `retired`; a partition of the whole Минздрав book over the published directions, plus additive extras, so every specialty a doctor can pick resolves to a direction                                                                                                                                                                                                                                                                                                                                                                                          |
| `direction_adjacency`   | 77                | 75 `active` · 2 `retired`; 37 `related` · 34 `interdisciplinary` · 6 `subdiscipline`, weights 38–90. Directed and loop-free, one authored edge per ordered pair — «Targeting» below                                                                                                                                                                                                                                                                                                                                                                                           |
| `event_directions`      | 1 984             | 1 955 `active` · 29 `retired`; 1–3 directions per эфир, walked two per эфир so that every published direction leads to an upcoming published эфир inside every 14-day feed window at any pin                                                                                                                                                                                                                                                                                                                                                                                  |
| `project_experts`       | 51                | 48 `active` · 3 `retired`; 14 `curator` (exactly one active curator per project) · 37 `member`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `project_partners`      | 30                | 28 `active` · 2 `retired`; 14 `is_primary` — at most one per project — and 16 secondary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
4. **Floors under a shape, not censuses.** The calendar rule above is the
   decision; the tests pin floors _under_ it and replay them at several pins
   rather than counting rows once — every day of the season carries an эфир, no
   future non-Sunday day is without a `published` one, the season total stays in
   the same band whatever weekday the seed runs on, every lifecycle state is
   derived from the timeline, every verified volume doctor holds 15 to 40
   эфиров, about a tenth of the roster is cancelled. Add rows freely; raising a
   floor means adding the rows _and_ the assertion in the same PR, never
   relaxing one.
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

### Targeting

Rows in seven families do not make a doctor's feed non-empty by themselves. What
does is the CHAIN: a doctor picks a specialty from the closed Минздрав book, the
book resolves to a direction, and the direction resolves to эфиры. Break any
link and the walkthrough lands on an empty feed while every count above still
looks healthy — which is exactly the failure #2213 was opened for.

So the chain is authored as an invariant rather than as data that happens to
line up, and a `#2213:` test in `golden.spec.ts` locks each step:

1. **Every specialty of the book links to a published direction.** The 118
   `Раздел I` names are PARTITIONED over the 38 published directions in
   `taxonomy.ts` (each name in exactly one direction), and the extras add to
   that partition instead of replacing part of it. A specialty the partition
   missed would be a doctor whose own profile leads nowhere.
2. **Every published direction leads to an upcoming published эфир INSIDE
   EVERY 14-DAY FEED HORIZON.** The `event_directions` walk is a contiguous
   `upcomingCounter % 38` sweep over the published directions, TWO directions
   per эфир, so the 38-direction cycle closes every 19 эфиров (about ten days)
   — inside any horizon the doctor feed can open (`DOCTOR_EVENTS_FEED_HORIZON_DAYS`
   = 14), at any pin, not only at the authored one. One direction per эфир
   closed the cycle only every ~19 days and left a third of the specialties
   with an empty first window. This is the invariant that makes «pick any
   specialty ⇒ a non-empty feed» true rather than likely; the test replays it
   over every window of the season.
3. **Adjacency is a directed, loop-free graph with one authored edge per ordered
   pair.** 77 edges, `related` / `interdisciplinary` / `subdiscipline`, weighted
   38–90, and every published direction is touched by at least one — so the
   «смежные направления» surface has something to show wherever the doctor
   enters it, and a recommendation walk cannot cycle.

The seed order follows the chain: `directions` and `partners` are written before
`events`, and every link table (`direction_specialties`, `direction_adjacency`,
`event_directions`, `project_experts`, `project_partners`) after both of its
parents. `resolveDirectionSpecialtyRows` maps the authored specialty NAMES onto
the seeded book's ids and fails loudly on a name the book does not carry — a
link table silently short of rows is the empty feed again, one level down.

### Media

A catalogue of эфиры without a single speaker photo and without a single
programme is not the product: the doctor page renders a portrait next to every
speaker and a «Скачать программу» download when `events.program_pdf_ref` is set.
Rows alone cannot make those surfaces real, so the seed writes objects too.

| Key                                     | Content type      | Count | Source                                           |
| --------------------------------------- | ----------------- | ----- | ------------------------------------------------ |
| `golden/experts/<ordinal>.webp`         | `image/webp`      | 34    | committed file, `media/portraits/<ordinal>.webp` |
| `golden/events/<ordinal>/programme.pdf` | `application/pdf` | 616   | rendered at seed time from the эфир's own rows   |
| `golden/partners/<ordinal>.svg`         | `image/svg+xml`   | 14    | generated wordmark, from the partner's own title |

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
`published` / `live` / `ended` / `in_archive` volume эфир carries one except
every sixth upcoming one (616 of 657 eligible rows, ~94 %; 41 of the 252
upcoming эфиры are left without), which keeps the «программа готовится» plaque
on the page walkable at any pin. `draft` and `hidden` эфиры carry none.

**Partner logos.** Generated like the programmes, but pin-INVARIANT: a wordmark
is the partner's own title set on a brand field, and nothing in it moves with
«now». `renderPartnerLogoSvg` emits an inline SVG — a gradient chip carrying the
title's initials, the title itself, and a strapline — with the brand colour
derived from the row's ordinal (`hsl(ordinal × 37 mod 360, 62 %, 42 %)`,
converted to a HEX literal so the bytes carry no renderer-dependent colour
syntax; the ×37 step keeps two partners adjacent in the admin list off
neighbouring hues). Because the bytes cannot drift under a stable key, the plan
marks them `if-absent` the way it marks a committed portrait, so a slot bucket
cloned from the template does not re-upload fourteen logos on every `slot up`.

**Where the objects go.** `seedGolden(db, { media })` takes a
`GoldenMediaStore { exists, put }`; the unit suite injects
`createInMemoryGoldenMediaStore()`, and `run.ts` builds an S3 store from
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_UPLOADS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
(`S3_FORCE_PATH_STYLE` defaults on, for MinIO). A missing variable **refuses the
run** and names every missing one at once, exactly like the `DATABASE_URL`
check: there is no skip flag and no fake store on the production path, because a
seed that quietly wrote rows pointing at objects nobody uploaded is worse than a
seed that failed. The per-slot bucket and this environment are wired by #2223.

**Idempotency.** The plan is pure — a list of
`{key, contentType, bytes, refresh}` built from the dataset at the pin — and
each entry says how it is written, eight at a time:

- `refresh: "if-absent"` (the **portraits**) is PUT only when `exists()` reports
  the key absent. File and key both come from git, so an object already in the
  bucket is exactly the object the plan would upload, and a slot re-raise should
  not re-send thirty-four faces.
- `refresh: "always"` (the **programmes**) is PUT unconditionally. The key is
  ordinal-derived and therefore pin-invariant while the page is re-dated at
  every pin, so a skip-on-`exists` writer would leave the persistent `main` slot
  serving a programme dated at whatever pin first filled the bucket, disagreeing
  with its own эфир row for as long as the bucket lives.

So a re-seed re-renders every programme (it always matches the rows) and writes
0 portraits; `writeGoldenMedia` reports the two counts separately (`written` /
`skipped`) and `seed:golden` prints both. Because the bytes are pin-deterministic
the unconditional PUT is still a no-op change at an unchanged pin — the media
half keeps the same «a second run changes nothing observable» rule as the rows.
Media is written **before** the row transaction: a failed upload aborts the seed
with no rows referring to a missing object.

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
