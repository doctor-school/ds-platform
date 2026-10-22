#!/usr/bin/env tsx
/**
 * 005 portal-integration fixture seed (#574) + 006 room-integration extension
 * (#584). Seeds one event in EACH lifecycle state the portal renders + E2E-drives
 * — `published` (upcoming), `live`, `ended`, `hidden` —
 * so the registered-state overlay, the one-tap / guest-through-auth registration
 * flows, «мои события», and the ended/hidden gating can be driven against the
 * LIVE dev stand.
 *
 * 006 room additions (#584): the room read (`GET /v1/events/:idOrSlug/room`) LEFT
 * JOINs `stream_config` to instantiate the EARS-2 player from the provider enum,
 * so the room E2E (`apps/portal/e2e/room.spec.ts`, `room-chat.spec.ts`) needs LIVE
 * events carrying a seeded stream config. This seed now (a) attaches a `rutube`
 * stream config to `seed-005-live` (the happy-path live room — SLUG_LIVE / the
 * chat + heartbeat room), and (b) adds the EARS-2 provider-variant live events:
 * `seed-006-room-youtube` (youtube), `seed-006-room-rutube` (rutube), and
 * `seed-006-room-unavailable` (live but deliberately NO stream config → the
 * truthful "stream unavailable" state), and (c) the 006 EARS-18 pair (#1932)
 * `seed-006-room-vk` (vk — parent-observable via `js_api=1`) +
 * `seed-006-room-cdnvideo` (cdnvideo — structurally silent), which
 * `apps/portal/e2e/room-player-false-positive.spec.ts` drives. The roster the room gate requires is NOT
 * seeded — a `registrations` row needs a real `users.id` (003 mirror) that only
 * exists after a real Zitadel signup, so the room E2E self-provisions its doctor
 * via the real 003 signup + 005 registration flow and enters the room (the
 * downstream #584 e2e brief owns that). This seed provides stream config only.
 *
 * This is the tracked 005/006 ↔ 007 fixture seam (parent #564): until feature
 * 007's admin authoring + lifecycle transitions + stream-config authoring drive
 * these, this script stands in. "Done against the real dependency" = the journey
 * runs on events authored + transitioned + stream-configured through 007, at
 * which point this seed is retired. It writes the 007-owned `events` +
 * `stream_config` write models directly (a fixture, not a product path) — never a
 * hack in a runtime handler. Live-state specs also stamp `events.live_at`
 * (= `startsAt` — the event went live when it started; #717): in the product
 * path 007's lifecycle transition stamps it, so without the seed doing the same
 * the room-header live-duration element (#703) is not demonstrable on a stand.
 * Non-live states leave `live_at` untouched (null).
 *
 * Idempotent: upserts by the stable `seed-005-*` / `seed-006-*` slug (and the
 * `stream_config` row by its `event_id` PK), so re-running refreshes the instants
 * (times are relative to `now`) + config in place without duplicating rows. It
 * ONLY touches its own `seed-005-*` / `seed-006-*` slugs — it never truncates the
 * table or a branch DB, so it is safe on a shared/branch stand.
 *
 * Run with the branch DB URL injected (never edit `.env.local`; see
 * `.claude/rules/dev-stand.md` / `reference_local_api_portal_live_run_recipe`):
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   DATABASE_URL=postgres://…/ds_dev_584 pnpm --filter @ds/api seed:events
 *
 * Prints a JSON object (its stdout contract): `events` maps every seeded slug to
 * its state, and `room` maps each room-E2E env var to the slug it should carry, so
 * a caller / E2E env wiring can pick the slug for each state + room scenario;
 * `congress` maps `CONGRESS_SIGNUP_EVENT_ID` to the fixed id of the congress
 * fixture (044, #3149) the stand contract already carries; `eventPage` maps each
 * event-page e2e env var (020 / 014 EARS-7, #2996) to the slug carrying the
 * shape that spec asserts ({@link SEED_EVENT_PAGE_SLUGS}).
 *
 * #2996 — speakers. An event's speaker list is `event_experts` links to
 * PUBLISHED experts (012 EARS-24). The seed does not invent expert records: its
 * speakers are the golden volume expert fixtures (`buildGoldenVolume`, the same
 * `@ds/db/seed/golden` source `SEED_EVENT_KINDS` comes from), inserted by their
 * golden id — never overwriting a row `seed:golden` already wrote — and then
 * linked to the fixtures that declare `speakers`.
 * Exits non-zero on failure.
 */
import { pathToFileURL } from "node:url";
import {
  createDrizzle,
  eventExperts,
  eventRecordings,
  events,
  experts,
  streamConfig,
} from "@ds/db";
import { SEED_EVENT_KINDS, buildGoldenVolume } from "@ds/db/seed/golden";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The recording kind the fixture's published cut occupies.
 *
 * Taken from the `recording_kind` enum's OWN type rather than written as a bare
 * string: the seed previously inserted `"full"`, which is not a member of the
 * enum (`["edited", "raw"]`), so every seed run died on
 * `invalid input value for enum recording_kind` the moment it reached the 014
 * legacy fixture — and nothing caught it, because this script is outside the
 * app's `tsc` program. `edited` is the right member: it is the cut
 * `recordings.projection` prefers for playback, which is what the archive эфир
 * fixture exists to make playable.
 */
type RecordingKind = (typeof eventRecordings.kind.enumValues)[number];

const EDITED_RECORDING_KIND: RecordingKind = "edited";

/**
 * 014 EARS-8 (#1345): the raw capture — the SECOND cut the both-cuts fixture
 * publishes. Same enum-derived typing as the montage above, for the same reason:
 * this script is outside the app's `tsc` program, so a bare string would only
 * fail at runtime against the `recording_kind` enum.
 */
const RAW_RECORDING_KIND: RecordingKind = "raw";

/**
 * 044 EARS-5 (#3149) — the congress fixture the dev stand's public congress
 * intake registers for. Its id is FIXED, unlike every other fixture here: the
 * api learns the congress event from `CONGRESS_SIGNUP_EVENT_ID`, and the stand
 * contract (`infra/dev-stand/.env.example`) carries this exact value, so every
 * stand database this seed ran on — `ds_dev` or a `pnpm dev:db:branch` database —
 * answers the same key without a per-database lookup.
 */
export const SEED_CONGRESS_EVENT_ID = "5eed0044-0000-4000-8000-000000000044";
export const SEED_CONGRESS_EVENT_SLUG = "seed-044-congress";

/**
 * #2996 — the event-page e2e env vars → the seed slug carrying the shape each
 * spec asserts (`apps/portal/e2e/event-page-020.e2e.spec.ts`,
 * `apps/portal/e2e/webinar-archive.spec.ts`, `apps/doctor/e2e/event-page*.spec.ts`).
 * The playwright config headers list the same pairs for a local run.
 */
export const SEED_EVENT_PAGE_SLUGS = Object.freeze({
  /** `published`, online, with speakers — both hosts' event-page specs. */
  E2E_WEBINAR_SLUG: "seed-005-upcoming",
  /** `ended`, no participation control (020 EARS-1). */
  E2E_WEBINAR_SLUG_ENDED: "seed-005-ended",
  /** `ended` with a single published montage and speakers (014 EARS-4/21). */
  E2E_ENDED_WEBINAR_SLUG: "seed-014-ended-month-ago",
  /** `ended`, no published recording, `recording_expected_by` set (014 EARS-7). */
  E2E_PREPARING_WEBINAR_SLUG: "seed-005-ended-preparing",
  /** `ended`, no published recording and NO `recording_expected_by` (014 EARS-7). */
  E2E_PREPARING_UNDATED_WEBINAR_SLUG: "seed-005-ended",
  /** Hybrid with seats left — the format tabs open on «очно» (020 EARS-8). */
  E2E_HYBRID_SLUG: "seed-005-hybrid",
  /** Hybrid with `seats_left = 0` — opens on «онлайн» and says why (020 EARS-9). */
  E2E_HYBRID_SOLDOUT_SLUG: "seed-005-hybrid-sold-out",
  /** Pure offline with `seats_left = 0` — «мест нет», no control (020 EARS-9). */
  E2E_OFFLINE_SOLDOUT_SLUG: "seed-005-offline-sold-out",
  /** The EARS-19 honesty sweep: format × phase (online / offline / hybrid · upcoming / ended). */
  E2E_SWEEP_SLUGS: [
    "seed-005-upcoming",
    "seed-005-ended",
    "seed-005-offline",
    "seed-005-offline-sold-out",
    "seed-005-hybrid",
    "seed-005-hybrid-sold-out",
  ].join(","),
});

/**
 * #2996 — how many golden volume experts the seed links as speakers (the first
 * N published ones of `buildGoldenVolume(...).experts`): a handful, so the
 * fixtures read as a real programme without the seed owning the catalogue.
 */
const SPEAKER_EXPERT_COUNT = 4;

/** 012 EARS-26 / EARS-29 (#2509) — the event's kind and its audience. */
interface SeedClassification {
  readonly kindId: string;
  readonly audience: "doctors" | "experts";
  readonly participationFormat: "online" | "offline" | "hybrid";
}

/**
 * The portal (Academy) stand fixtures: the all-formats «Встреча клуба» kind,
 * audience `experts` (the Academy reads).
 */
const ACADEMY_FIXTURE: SeedClassification = {
  kindId: SEED_EVENT_KINDS.vstrechaKluba.id,
  audience: "experts",
  participationFormat: "online",
};

interface SeedSpec {
  /** A fixed primary key; omitted ⇒ the column default mints one. */
  readonly id?: string;
  /** Omitted ⇒ {@link ACADEMY_FIXTURE}. */
  readonly classification?: SeedClassification;
  readonly slug: string;
  readonly state: "published" | "live" | "ended" | "hidden" | "in_archive";
  /**
   * 014 EARS-23 (#1741): which lifecycle machine this fixture sits on. Omitted
   * ⇒ `platform`, the column default and what every 005/006 fixture is.
   */
  readonly origin?: "platform" | "legacy";
  readonly title: string;
  readonly school: string;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly description: string;
  readonly specialties: string[];
  readonly partnerRef: string;
  readonly venue?: NonNullable<(typeof events.$inferInsert)["venue"]>;
  /**
   * 020 LD-5 (#2996): the remaining offline seats — `0` is «мест нет». Omitted ⇒
   * the column is left untouched (an online fixture has no seat limit).
   */
  readonly seatsLeft?: number;
  /**
   * 014 EARS-1/7 (#2996): the day the operator promises the recording by, as
   * days after the seed run (a `date`, rendered «до <day> <month>»). Omitted ⇒
   * the column is left untouched.
   */
  readonly recordingExpectedInDays?: number;
  /**
   * #2996: the event's speakers — golden volume experts (index into the first
   * {@link SPEAKER_EXPERT_COUNT}) in presentation order, each with its
   * event-specific role. Present ⇒ the event's active `event_experts` links are
   * reconciled to exactly this list; omitted ⇒ its links are left untouched.
   */
  readonly speakers?: readonly {
    readonly expert: number;
    readonly role: string;
  }[];
  /**
   * 006 (#584): the event's stream config the room's EARS-2 player is
   * instantiated from. Omitted → no `stream_config` row is written (and any
   * prior one is removed), so the room resolves the truthful "stream
   * unavailable" state. `embedRef` is the provider-scoped stream id (never a URL
   * — the portal builds the embed URL from the provider enum).
   */
  readonly stream?: {
    readonly provider: "rutube" | "youtube" | "vk" | "cdnvideo";
    readonly embedRef: string;
  };
  /**
   * 014 EARS-24/26 (#1741): a PUBLISHED, non-retired recording. Only the legacy
   * archive fixture carries one — an `in_archive` эфир without it is a state the
   * product cannot reach (the archive command is gated on exactly this fact), so
   * seeding one would be a fixture that lies about the machine.
   */
  readonly recording?: {
    readonly provider: "rutube" | "youtube";
    readonly embedRef: string;
    readonly durationSec: number;
  };
  /**
   * 014 EARS-8 (#1345): the SECOND published cut — the raw capture — alongside
   * `recording`'s montage. Only the both-cuts fixture carries one: the
   * «Смотреть оригинал трансляции» spoiler exists exactly when an эфир
   * published both kinds, so a fixture with a single cut cannot prove either
   * half of that rule.
   */
  readonly rawRecording?: {
    readonly provider: "rutube" | "youtube";
    readonly embedRef: string;
    readonly durationSec: number;
  };
}

function specs(now: number): SeedSpec[] {
  return [
    {
      // 044 EARS-5 (#3149): the congress the stand's public intake registers
      // for — registrable (published, two months out), a «Конгресс» for
      // doctors held in person, and with a venue, because the intake refuses
      // an event without one before any side effect (044 EARS-13, #2517).
      id: SEED_CONGRESS_EVENT_ID,
      classification: {
        kindId: SEED_EVENT_KINDS.kongress.id,
        audience: "doctors",
        participationFormat: "offline",
      },
      slug: SEED_CONGRESS_EVENT_SLUG,
      venue: "Москва, тестовая площадка (эталон)",
      state: "published",
      title: "Конгресс ортобиологии (стенд)",
      school: "Конгресс",
      startsAt: new Date(now + 60 * DAY),
      durationMin: 480,
      description:
        "Ежегодный конгресс: пленарные доклады, секции и постерная сессия. Регистрация открыта.",
      specialties: ["Травматология и ортопедия"],
      partnerRef: "sponsor:congress",
    },
    {
      slug: "seed-005-upcoming",
      state: "published",
      title: "Управление артериальной гипертензией в 2026",
      school: "Школа кардиологии",
      // Comfortably in the future so it renders as «Скоро» and stays registrable.
      startsAt: new Date(now + 7 * DAY),
      durationMin: 90,
      // The 020 Stage-B fixture (#1779): this is the ONE event the owner drives
      // the shared page on, so every field the EARS-1 read model carries is
      // populated to a realistic length — a one-line description and a two-word
      // regalia made the page look under-filled when the blocks were in fact
      // rendering everything they were given.
      description:
        "Целевые уровни давления, выбор стартовой терапии и работа с резистентной гипертензией: показания, доказательная база и рабочие протоколы. Разбираем реальный клинический случай — от первичного приёма до оценки результата через 6 месяцев. Вопросы спикеру — прямо в чате эфира.",
      specialties: ["Кардиология", "Терапия", "Общая врачебная практика"],
      partnerRef: "Партнёр Фарма",
      speakers: [
        { expert: 0, role: "Спикер" },
        { expert: 1, role: "Модератор" },
      ],
    },
    {
      // A SECOND registrable event so the logged-in one-tap path (EARS-1) can be
      // driven on an event the doctor is not yet registered for, independently of
      // the guest-through-auth journey that consumes `seed-005-upcoming`.
      slug: "seed-005-upcoming-2",
      state: "published",
      title: "Иммунотерапия: практикум для онкологов",
      school: "Школа онкологии",
      startsAt: new Date(now + 10 * DAY),
      durationMin: 120,
      description:
        "Практический разбор схем иммунотерапии и управления нежелательными явлениями. Регистрация открыта.",
      specialties: ["Онкология"],
      partnerRef: "Партнёр Фарма",
    },
    {
      // A THIRD registrable event — a spare unregistered `published` event for
      // driving the one-tap path repeatedly / for the browser journey (brief B).
      slug: "seed-005-upcoming-3",
      state: "published",
      title: "Ревматология: ранняя диагностика",
      school: "Школа ревматологии",
      startsAt: new Date(now + 14 * DAY),
      durationMin: 90,
      description:
        "Ранние маркеры и алгоритмы диагностики. Регистрация открыта.",
      specialties: ["Ревматология"],
      partnerRef: "Партнёр Фарма",
    },
    {
      slug: "seed-005-live",
      state: "live",
      title: "Прямой эфир: неотложная неврология",
      school: "Школа неврологии",
      // Started recently, still inside its window → renders «В эфире».
      startsAt: new Date(now - 15 * MINUTE),
      durationMin: 120,
      description:
        "Живой разбор пациентов с острой неврологической симптоматикой. Регистрация во время эфира открыта.",
      specialties: ["Неврология"],
      partnerRef: "Партнёр Фарма",
      // 006 (#584): the happy-path live room — SLUG_LIVE for the EARS-3 chat +
      // EARS-4 heartbeat E2E — carries a `rutube` stream config so the room read
      // resolves a non-null player instead of "stream unavailable". The embedRef
      // is a verified PUBLICLY playable video (#717): its detail API returns 200
      // with `is_hidden:false` (an author-hidden id returns 403 and the player
      // renders «Автор скрыл это видео» instead of content).
      stream: {
        provider: "rutube",
        embedRef: "cef3a41b70985eedeefe504452a69adc",
      },
    },
    // ── 006 room-integration live fixtures (#584) ──────────────────────────────
    // The EARS-2 provider-variant live rooms `apps/portal/e2e/room.spec.ts` drives:
    // one per provider enum value + one deliberately unconfigured. All `live` so the
    // room admission gate's `live` condition passes; the roster is built live by the
    // E2E (self-registration), not seeded here.
    {
      slug: "seed-006-room-youtube",
      state: "live",
      title: "Прямой эфир: кардиология (YouTube)",
      school: "Школа кардиологии",
      startsAt: new Date(now - 10 * MINUTE),
      durationMin: 120,
      description:
        "Живой разбор клинических случаев. Тестовая комната с YouTube-плеером для интеграционной проверки.",
      specialties: ["Кардиология"],
      partnerRef: "Партнёр Фарма",
      stream: { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
    },
    {
      slug: "seed-006-room-rutube",
      state: "live",
      title: "Прямой эфир: пульмонология (Rutube)",
      school: "Школа пульмонологии",
      startsAt: new Date(now - 10 * MINUTE),
      durationMin: 120,
      description:
        "Живой разбор клинических случаев. Тестовая комната с Rutube-плеером для интеграционной проверки.",
      specialties: ["Пульмонология"],
      partnerRef: "Партнёр Фарма",
      stream: {
        provider: "rutube",
        embedRef: "b9e7d1a4c2f5e8039a6b1c4d7e0f3a25",
      },
    },
    // 006 EARS-18 (#1932): the two provider-observability classes the
    // player-failure state machine treats differently — `vk` is parent-observable
    // (its embed carries `js_api=1`, so real playback produces a real `playing`
    // signal and the watchdog never fires), `cdnvideo` is structurally silent (no
    // provider channel at all, so the room renders NOTHING of its own over the
    // embed). `apps/portal/e2e/room-player-false-positive.spec.ts` drives both.
    {
      slug: "seed-006-room-vk",
      state: "live",
      title: "Прямой эфир: неврология (VK)",
      school: "Школа неврологии",
      startsAt: new Date(now - 10 * MINUTE),
      durationMin: 120,
      description:
        "Живой разбор клинических случаев. Тестовая комната с VK-плеером для интеграционной проверки.",
      specialties: ["Неврология"],
      partnerRef: "Партнёр Фарма",
      stream: {
        // A PUBLIC, embeddable VK video: the fixture must actually play on a
        // stand, or the EARS-18.2 live drive would be pinning a dead embed
        // instead of the false-positive path. This is the same video whose raw
        // `js_api=1` traffic was captured in the #1904 live drive; the schema
        // fixture `-9944999_456239622_…` is no longer resolvable (VK answers
        // «video not found», probed 2026-09-06), so it stays a SCHEMA fixture
        // only. No `_hash` — the hash is optional for a public video (#1134).
        provider: "vk",
        embedRef: "-22822305_456241864",
      },
    },
    {
      slug: "seed-006-room-cdnvideo",
      state: "live",
      title: "Прямой эфир: эндокринология (CDNvideo)",
      school: "Школа эндокринологии",
      startsAt: new Date(now - 10 * MINUTE),
      durationMin: 120,
      description:
        "Живой разбор клинических случаев. Тестовая комната с CDNvideo-плеером для интеграционной проверки.",
      specialties: ["Эндокринология"],
      partnerRef: "Партнёр Фарма",
      stream: {
        provider: "cdnvideo",
        embedRef:
          "https://playercdn.cdnvideo.ru/aloha/players/auto_player1.html?clid=kcta544ubo&plid=c263cdf6-253e-400b-a008-d1775d3ee190",
      },
    },
    {
      slug: "seed-006-room-unavailable",
      state: "live",
      title: "Прямой эфир: без сконфигурированного потока",
      school: "Школа терапии",
      startsAt: new Date(now - 10 * MINUTE),
      durationMin: 120,
      description:
        "Живая комната без stream config — проверяет правдивое состояние «поток недоступен» вместо угаданного плеера.",
      specialties: ["Терапия"],
      partnerRef: "Партнёр Фарма",
      // No `stream` → no stream_config row → the room renders "stream unavailable".
    },
    {
      slug: "seed-005-ended",
      state: "ended",
      title: "Итоги: диабет и коморбидность",
      school: "Школа эндокринологии",
      startsAt: new Date(now - 2 * DAY),
      durationMin: 75,
      description:
        "Завершённый эфир — регистрация закрыта. Разбор коморбидных состояний при сахарном диабете 2 типа.",
      specialties: ["Эндокринология"],
      partnerRef: "Партнёр Фарма",
      // 014 EARS-7: ended, nothing published and NO committed day — the
      // UNDATED «запись готовится» plaque.
      speakers: [{ expert: 2, role: "Спикер" }],
    },
    {
      slug: "seed-005-ended-preparing",
      state: "ended",
      title: "Разбор: антикоагулянтная терапия при фибрилляции предсердий",
      school: "Школа кардиологии",
      startsAt: new Date(now - 3 * DAY),
      durationMin: 90,
      description:
        "Завершённый эфир — регистрация закрыта. Выбор антикоагулянта у пожилых пациентов с фибрилляцией предсердий и хронической болезнью почек: оценка риска кровотечений, коррекция доз, переход между препаратами.",
      specialties: ["Кардиология"],
      partnerRef: "Партнёр Фарма",
      // 014 EARS-7 (#2996): the эфир ended, nothing is published yet, and the
      // operator has committed to a day — the DATED «запись готовится» plaque.
      recordingExpectedInDays: 5,
      speakers: [
        { expert: 1, role: "Ведущий" },
        { expert: 3, role: "Спикер" },
      ],
    },
    // ── wave-3 format × seats fixtures (#2996, 020 EARS-8/9/19) ─────────────
    // The four in-person shapes the event page's format block distinguishes:
    // offline / hybrid, each with seats left and sold out. Registrable
    // (`published`, in the future) Academy events of the all-formats kind.
    {
      classification: { ...ACADEMY_FIXTURE, participationFormat: "offline" },
      slug: "seed-005-offline",
      state: "published",
      title: "Клинический разбор: хроническая сердечная недостаточность",
      school: "Школа кардиологии",
      startsAt: new Date(now + 12 * DAY),
      durationMin: 180,
      venue: "Москва, ул. Тверская, 22, конференц-зал «Пушкинский»",
      seatsLeft: 24,
      description:
        "Очная встреча клуба: три клинических случая ХСН со сниженной фракцией выброса — титрация квадротерапии, ведение при гипотонии и почечной дисфункции, показания к устройствам. Работа в малых группах, вопросы ведущему по ходу разбора.",
      specialties: ["Кардиология", "Терапия"],
      partnerRef: "Партнёр Фарма",
      speakers: [{ expert: 0, role: "Ведущий" }],
    },
    {
      classification: { ...ACADEMY_FIXTURE, participationFormat: "offline" },
      slug: "seed-005-offline-sold-out",
      state: "published",
      title: "Мастерская: УЗИ-навигация при внутрисуставных инъекциях",
      school: "Школа ортобиологии",
      startsAt: new Date(now + 16 * DAY),
      durationMin: 240,
      venue: "Санкт-Петербург, Невский пр., 55, учебный центр, зал 3",
      seatsLeft: 0,
      description:
        "Практическая мастерская на фантомах: доступы к коленному, плечевому и тазобедренному суставам под УЗИ-контролем, типичные ошибки и профилактика осложнений. Группа ограничена числом рабочих мест у аппаратов.",
      specialties: ["Травматология и ортопедия", "Ревматология"],
      partnerRef: "Партнёр Фарма",
      speakers: [{ expert: 3, role: "Ведущий" }],
    },
    {
      classification: { ...ACADEMY_FIXTURE, participationFormat: "hybrid" },
      slug: "seed-005-hybrid",
      state: "published",
      title: "Сахарный диабет 2 типа: интенсификация терапии",
      school: "Школа эндокринологии",
      startsAt: new Date(now + 9 * DAY),
      durationMin: 120,
      venue: "Москва, Краснопресненская наб., 12, ЦМТ, конгресс-зал",
      seatsLeft: 40,
      description:
        "Встреча клуба в зале и онлайн: когда и как интенсифицировать сахароснижающую терапию, место агонистов ГПП-1 и иНГЛТ-2, старт инсулинотерапии. Разбираем случаи участников — присылайте вопросы заранее или задавайте в чате трансляции.",
      specialties: ["Эндокринология", "Терапия"],
      partnerRef: "Партнёр Фарма",
      speakers: [
        { expert: 2, role: "Спикер" },
        { expert: 1, role: "Модератор" },
      ],
    },
    {
      classification: { ...ACADEMY_FIXTURE, participationFormat: "hybrid" },
      slug: "seed-005-hybrid-sold-out",
      state: "published",
      title: "Неврология: головная боль в практике терапевта",
      school: "Школа неврологии",
      startsAt: new Date(now + 11 * DAY),
      durationMin: 90,
      venue: "Казань, ул. Баумана, 9, отель «Кремлёвский», зал «Волга»",
      seatsLeft: 0,
      description:
        "Мигрень, головная боль напряжения и «красные флаги» вторичной головной боли: алгоритм приёма, профилактическая терапия и когда направлять к неврологу. Очные места разобраны — участие онлайн открыто.",
      specialties: ["Неврология", "Терапия"],
      partnerRef: "Партнёр Фарма",
      speakers: [{ expert: 3, role: "Спикер" }],
    },
    // ── 014 both-cuts fixture (#1345) ────────────────────────────────────────
    // The ONE эфир that published BOTH cuts: the montage `recordings.projection`
    // resolves as primary (EARS-3) and the raw capture it resolves as secondary.
    // It exists so the EARS-8 spoiler can be driven end-to-end — its presence
    // here and its ABSENCE on every single-cut fixture are the two halves of the
    // same rule, and a fixture that carried only one kind could prove neither.
    {
      slug: "seed-014-ended-both-cuts",
      state: "ended",
      title: "Итоги: два варианта записи (монтаж и оригинал)",
      school: "Школа кардиологии",
      startsAt: new Date(now - 3 * DAY),
      durationMin: 124,
      description:
        "Завершённый эфир с двумя опубликованными записями — смонтированной версией и оригиналом трансляции без монтажа.",
      specialties: ["Кардиология"],
      partnerRef: "Партнёр Фарма",
      recording: {
        provider: "rutube",
        embedRef: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        durationSec: 96 * 60,
      },
      rawRecording: {
        provider: "rutube",
        embedRef: "0f9e8d7c6b5a493827160f5e4d3c2b1a",
        durationSec: 124 * 60,
      },
      speakers: [{ expert: 0, role: "Спикер" }],
    },
    // ── wave-2 «Прошедшие» widening fixture (#2028, gate row 32) ─────────────
    // An ended эфир a month back with a published montage whose length the
    // canvas recording line reads («Запись · 1 ч 12 мин»).
    {
      slug: "seed-014-ended-month-ago",
      state: "ended",
      title: "Итоги: остеоартрит коленного сустава",
      school: "Школа ортобиологии",
      startsAt: new Date(now - 30 * DAY),
      durationMin: 80,
      description:
        "Завершённый эфир месячной давности с опубликованной записью — разбор тактики при остеоартрите.",
      specialties: ["Ревматология"],
      partnerRef: "Партнёр Фарма",
      recording: {
        provider: "rutube",
        embedRef: "5d1c9e7a3b2f48a6c0e4d8b1f7a9c2e3",
        durationSec: 72 * 60,
      },
      speakers: [
        { expert: 3, role: "Спикер" },
        { expert: 2, role: "Спикер" },
      ],
    },
    // ── 014 legacy-archive fixture (#1741) ────────────────────────────────────
    // The ONE `legacy` эфир: an archive-only broadcast the platform never
    // hosted, sitting in the legacy machine's `in_archive` state with a
    // published recording. It exists so the admin lifecycle bar and the public
    // «Прошедшие» tab can be driven against a real archived эфир — the state a
    // `platform` fixture can never be in.
    {
      slug: "seed-006-legacy-archived",
      state: "in_archive",
      origin: "legacy",
      title: "Архивный эфир: инсулинотерапия (до платформы)",
      school: "Школа эндокринологии",
      startsAt: new Date(now - 400 * DAY),
      durationMin: 80,
      description:
        "Эфир проведён до запуска платформы. Доступна только запись — комнаты и регистрации у него не было.",
      specialties: ["Эндокринология"],
      partnerRef: "Партнёр Фарма",
      // No `stream` — a legacy эфир never acquires a stream config.
      recording: {
        provider: "rutube",
        embedRef: "cef3a41b70985eedeefe504452a69adc",
        durationSec: 80 * 60,
      },
    },
    {
      slug: "seed-005-hidden",
      state: "hidden",
      title: "Скрыт: базовая ЭКГ для терапевта",
      school: "Школа терапии",
      startsAt: new Date(now - 30 * DAY),
      durationMin: 60,
      description:
        "Эфир скрыт с платформы — регистрация и запись недоступны. Основы интерпретации ЭКГ.",
      specialties: ["Терапия"],
      partnerRef: "Партнёр Фарма",
    },
  ];
}

/**
 * The seed body, exported so an e2e spec can drive it in-process (the two-run
 * idempotency proof) without shelling out. The CLI entry below is guarded so an
 * import never triggers a run + `process.exit`.
 */
export async function seedEvents(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — inject the (branch) dev-stand DB URL before seeding.",
    );
  }

  const { pool, db } = createDrizzle(connectionString);
  const result: Record<string, string> = {};
  const now = Date.now();
  try {
    // #2996: the golden expert fixtures the speakers are. Inserted by their
    // golden id and otherwise left alone — a stand `seed:golden` already filled
    // keeps its own rows (and their write-once `first_published_at`).
    const speakerExperts = buildGoldenVolume(new Date(now))
      .experts.filter((expert) => expert.status === "published")
      .slice(0, SPEAKER_EXPERT_COUNT);
    if (speakerExperts.length < SPEAKER_EXPERT_COUNT) {
      throw new Error(
        `golden volume carries ${speakerExperts.length} published experts, the seed links ${SPEAKER_EXPERT_COUNT}`,
      );
    }
    const speakerIds = speakerExperts.map((expert) => expert.id as string);
    await db.insert(experts).values(speakerExperts).onConflictDoNothing();
    const published = await db
      .select({ id: experts.id })
      .from(experts)
      .where(
        and(
          inArray(experts.id, speakerIds),
          eq(experts.status, "published"),
          isNull(experts.deletedAt),
        ),
      );
    if (published.length !== SPEAKER_EXPERT_COUNT) {
      throw new Error(
        "a golden speaker expert is missing or unpublished on this stand — a speaker link needs a published expert",
      );
    }

    for (const spec of specs(now)) {
      // 007-seam (#717): a `live` event went live when it started — stamp
      // `live_at` so the room-header live-duration element renders. `undefined`
      // is skipped by Drizzle in both clauses, so non-live states leave the
      // column untouched (null).
      const liveAt = spec.state === "live" ? spec.startsAt : undefined;
      // 012 EARS-26 / EARS-29 (#2509): the kind, its audience and a format the
      // kind allows.
      const { kindId, audience, participationFormat } =
        spec.classification ?? ACADEMY_FIXTURE;
      // 014 EARS-1 (#2996): a `date` column — the calendar day, never an instant.
      // `null` (not `undefined`, which Drizzle skips) so a re-run clears a
      // day the spec no longer sets.
      const recordingExpectedBy =
        spec.recordingExpectedInDays === undefined
          ? null
          : new Date(now + spec.recordingExpectedInDays * DAY)
              .toISOString()
              .slice(0, 10);

      // Upsert the event by its stable slug so re-runs refresh the instant + state
      // in place (no duplicate rows, no table truncation — branch-safe).
      const [row] = await db
        .insert(events)
        .values({
          id: spec.id,
          slug: spec.slug,
          title: spec.title,
          school: spec.school,
          startsAt: spec.startsAt,
          durationMin: spec.durationMin,
          description: spec.description,
          specialties: spec.specialties,
          partnerRef: spec.partnerRef,
          venue: spec.venue,
          seatsLeft: spec.seatsLeft,
          recordingExpectedBy,
          state: spec.state,
          origin: spec.origin ?? "platform",
          kindId,
          audience,
          participationFormat,
          liveAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: events.slug,
          set: {
            title: spec.title,
            school: spec.school,
            startsAt: spec.startsAt,
            durationMin: spec.durationMin,
            description: spec.description,
            specialties: spec.specialties,
            partnerRef: spec.partnerRef,
            venue: spec.venue,
            seatsLeft: spec.seatsLeft,
            recordingExpectedBy,
            state: spec.state,
            origin: spec.origin ?? "platform",
            kindId,
            audience,
            participationFormat,
            liveAt,
            updatedAt: new Date(),
          },
        })
        .returning({ id: events.id });

      // 012 EARS-24 (#1607) + #2996 — an event's speaker list is `event_experts`
      // links to published experts. The seed's speakers are the golden expert
      // fixtures inserted above; the links are reconciled to `spec.speakers`.
      if (spec.speakers) {
        await reconcileSpeakers(
          db,
          row.id,
          spec.speakers.map(({ expert, role }, position) => ({
            expertId: speakerIds[expert]!,
            role,
            position,
          })),
        );
      }

      // 006 (#584): upsert the stream config by its `event_id` PK. A spec without
      // `stream` (e.g. the "unavailable" fixture) RETIRES any prior row so the
      // room stays truthfully unconfigured — #1278 §3.6: the retained row keeps
      // the fact that this event once had a stream, and a later spec that brings
      // the stream back restores that same row in place (§3.6 rule 2). Only ever
      // touches THIS event's row.
      if (spec.stream) {
        await db
          .insert(streamConfig)
          .values({
            eventId: row.id,
            provider: spec.stream.provider,
            embedRef: spec.stream.embedRef,
          })
          .onConflictDoUpdate({
            target: streamConfig.eventId,
            set: {
              provider: spec.stream.provider,
              embedRef: spec.stream.embedRef,
              recordStatus: "active",
              deletedAt: null,
            },
          });
      } else {
        await db
          .update(streamConfig)
          .set({ recordStatus: "retired", deletedAt: new Date() })
          .where(
            and(
              eq(streamConfig.eventId, row.id),
              eq(streamConfig.recordStatus, "active"),
            ),
          );
      }

      // 014 EARS-24/26 (#1741) + EARS-8 (#1345): upsert the fixture's PUBLISHED
      // cuts on the LD-1 at-most-one-active-per-kind slots. Keyed on
      // (event, kind) among non-retired rows, exactly like the product path, so
      // a re-run refreshes the same row instead of colliding with its own
      // previous one. Both kinds run through ONE body — a second copy for `raw`
      // would be a second place for the write-once `first_published_at` rule to
      // drift out of step with the product path.
      const cuts: {
        kind: RecordingKind;
        cut: NonNullable<SeedSpec["recording"]>;
      }[] = [
        ...(spec.recording
          ? [{ kind: EDITED_RECORDING_KIND, cut: spec.recording }]
          : []),
        ...(spec.rawRecording
          ? [{ kind: RAW_RECORDING_KIND, cut: spec.rawRecording }]
          : []),
      ];
      for (const { kind, cut } of cuts) {
        const [existing] = await db
          .select({
            id: eventRecordings.id,
            firstPublishedAt: eventRecordings.firstPublishedAt,
          })
          .from(eventRecordings)
          .where(
            and(
              eq(eventRecordings.eventId, row.id),
              eq(eventRecordings.kind, kind),
              isNull(eventRecordings.deletedAt),
            ),
          );
        const baseValues = {
          provider: cut.provider,
          embedRef: cut.embedRef,
          durationSec: cut.durationSec,
          status: "published" as const,
          updatedAt: new Date(),
        };
        if (existing) {
          // `first_published_at` is write-once (021 invariant, enforced by a
          // trigger): re-sending a fresh instant on a row that already carries
          // one aborts the whole seed. The re-run therefore refreshes only the
          // mutable columns, and stamps the instant solely when the existing
          // row has none — which the `published ⇒ first_published_at IS NOT
          // NULL` check still requires.
          await db
            .update(eventRecordings)
            .set(
              existing.firstPublishedAt
                ? baseValues
                : { ...baseValues, firstPublishedAt: new Date() },
            )
            .where(eq(eventRecordings.id, existing.id));
        } else {
          // The table's `published ⇒ first_published_at IS NOT NULL` check is a
          // product invariant, so the fixture satisfies it rather than working
          // around it: the archive эфир's cut was published when it was seeded.
          await db.insert(eventRecordings).values({
            ...baseValues,
            firstPublishedAt: new Date(),
            eventId: row.id,
            kind,
          });
        }
      }

      result[spec.slug] = spec.state;
    }
  } finally {
    await pool.end();
  }

  // The machine-readable result is the script's stdout contract: `events` (every
  // seeded slug → its state) + `room` (each room-E2E env var → the slug it carries).
  const contract = {
    events: result,
    room: {
      E2E_ROOM_SLUG_YOUTUBE: "seed-006-room-youtube",
      E2E_ROOM_SLUG_RUTUBE: "seed-006-room-rutube",
      E2E_ROOM_SLUG_UNAVAILABLE: "seed-006-room-unavailable",
      // 006 EARS-18 (#1932): the two provider-observability classes.
      E2E_ROOM_SLUG_VK: "seed-006-room-vk",
      E2E_ROOM_SLUG_CDNVIDEO: "seed-006-room-cdnvideo",
      // The happy-path live room for the EARS-3 chat + EARS-4 heartbeat E2E.
      E2E_ROOM_SLUG_LIVE: "seed-005-live",
    },
    // 014 EARS-8 (#1345): the archive E2E env vars → the slug each carries.
    archive: {
      E2E_BOTH_CUTS_WEBINAR_SLUG: "seed-014-ended-both-cuts",
    },
    // 044 EARS-5 (#3149): the api env key → the congress fixture it names.
    congress: {
      CONGRESS_SIGNUP_EVENT_ID: SEED_CONGRESS_EVENT_ID,
    },
    // #2996: the event-page e2e env vars → the slug each carries.
    eventPage: SEED_EVENT_PAGE_SLUGS,
  };
  process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

/**
 * #2996 — every seed slug that declares speakers: the event-page specs on both
 * hosts read each of them as an event WITH speakers.
 */
export const SEED_SPEAKER_SLUGS: readonly string[] = Object.freeze(
  specs(0)
    .filter((spec) => spec.speakers !== undefined)
    .map((spec) => spec.slug),
);

type SeedDb = ReturnType<typeof createDrizzle>["db"];

interface SpeakerLink {
  readonly expertId: string;
  readonly role: string;
  readonly position: number;
}

/**
 * #2996 — converge one event's ACTIVE `event_experts` links to `desired`, on the
 * product's own retained-row rules (012 §2.1): a link that no longer matches is
 * RETIRED (never deleted), a retired link for a desired expert is RESTORED in
 * place (the `(event, expert)` pair spans every retained row), and an unchanged
 * link is not written at all — so a re-run is a no-op. Retiring first frees every
 * position a moved link needs before it is re-taken (the active-position index).
 */
async function reconcileSpeakers(
  db: SeedDb,
  eventId: string,
  desired: readonly SpeakerLink[],
): Promise<void> {
  const existing = await db
    .select({
      id: eventExperts.id,
      expertId: eventExperts.expertId,
      role: eventExperts.role,
      position: eventExperts.position,
      status: eventExperts.status,
    })
    .from(eventExperts)
    .where(eq(eventExperts.eventId, eventId));
  const wanted = new Map(desired.map((link) => [link.expertId, link]));
  const matches = (
    link: (typeof existing)[number],
    want: SpeakerLink | undefined,
  ): boolean =>
    want !== undefined &&
    link.status === "active" &&
    link.role === want.role &&
    link.position === want.position;
  const bump = () => ({
    version: sql`${eventExperts.version} + 1`,
    updatedAt: new Date(),
  });

  for (const link of existing) {
    if (link.status === "active" && !matches(link, wanted.get(link.expertId))) {
      await db
        .update(eventExperts)
        .set({ ...bump(), status: "retired", deletedAt: new Date() })
        .where(eq(eventExperts.id, link.id));
    }
  }
  for (const want of desired) {
    const link = existing.find((row) => row.expertId === want.expertId);
    if (link && matches(link, want)) continue;
    if (link) {
      await db
        .update(eventExperts)
        .set({
          ...bump(),
          role: want.role,
          position: want.position,
          status: "active",
          deletedAt: null,
        })
        .where(eq(eventExperts.id, link.id));
    } else {
      await db.insert(eventExperts).values({ eventId, ...want });
    }
  }
}

const isCliEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry) {
  seedEvents()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(
        `[seed:events] FAILED — ${
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        }\n`,
      );
      process.exit(1);
    });
}
