#!/usr/bin/env tsx
/**
 * 005 portal-integration fixture seed (#574) + 006 room-integration extension
 * (#584). Seeds one event in EACH lifecycle state the portal renders + E2E-drives
 * — `published` (upcoming), `live`, `ended`, `hidden` — plus ordered speakers,
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
 * truthful "stream unavailable" state). The roster the room gate requires is NOT
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
 * a caller / E2E env wiring can pick the slug for each state + room scenario.
 * Exits non-zero on failure.
 */
import {
  createDrizzle,
  eventRecordings,
  events,
  streamConfig,
} from "@ds/db";
import { and, eq, isNull } from "drizzle-orm";
import { reconcileEventSpeakers } from "../src/events/event-speakers.reconcile.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface SeedSpec {
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
  readonly speakers: { readonly name: string; readonly regalia: string }[];
  /**
   * 006 (#584): the event's stream config the room's EARS-2 player is
   * instantiated from. Omitted → no `stream_config` row is written (and any
   * prior one is removed), so the room resolves the truthful "stream
   * unavailable" state. `embedRef` is the provider-scoped stream id (never a URL
   * — the portal builds the embed URL from the provider enum).
   */
  readonly stream?: {
    readonly provider: "rutube" | "youtube";
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
}

function specs(now: number): SeedSpec[] {
  return [
    {
      slug: "seed-005-upcoming",
      state: "published",
      title: "Управление артериальной гипертензией в 2026",
      school: "Школа кардиологии",
      // Comfortably in the future so it renders as «Скоро» and stays registrable.
      startsAt: new Date(now + 7 * DAY),
      durationMin: 90,
      description:
        "Разбор клинических рекомендаций и типичных ошибок терапии. Практические кейсы и ответы на вопросы.",
      specialties: ["Кардиология", "Терапия"],
      partnerRef: "Партнёр Фарма",
      speakers: [
        { name: "Проф. И. Соколова", regalia: "д.м.н., кардиолог" },
        { name: "Доц. А. Петров", regalia: "к.м.н., терапевт" },
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
      speakers: [{ name: "Проф. Д. Лебедев", regalia: "д.м.н., онколог" }],
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
      speakers: [{ name: "Проф. О. Зайцева", regalia: "д.м.н., ревматолог" }],
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
      speakers: [{ name: "Проф. Е. Морозова", regalia: "д.м.н., невролог" }],
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
      speakers: [{ name: "Проф. И. Соколова", regalia: "д.м.н., кардиолог" }],
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
      speakers: [{ name: "Доц. А. Петров", regalia: "к.м.н., пульмонолог" }],
      stream: {
        provider: "rutube",
        embedRef: "b9e7d1a4c2f5e8039a6b1c4d7e0f3a25",
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
      speakers: [{ name: "Доц. С. Кузнецов", regalia: "к.м.н., терапевт" }],
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
      speakers: [{ name: "Проф. Н. Волкова", regalia: "д.м.н., эндокринолог" }],
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
      speakers: [{ name: "Проф. Н. Волкова", regalia: "д.м.н., эндокринолог" }],
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
      speakers: [{ name: "Доц. С. Кузнецов", regalia: "к.м.н., терапевт" }],
    },
  ];
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — inject the (branch) dev-stand DB URL before seeding.",
    );
  }

  const { pool, db } = createDrizzle(connectionString);
  const result: Record<string, string> = {};
  try {
    for (const spec of specs(Date.now())) {
      // 007-seam (#717): a `live` event went live when it started — stamp
      // `live_at` so the room-header live-duration element renders. `undefined`
      // is skipped by Drizzle in both clauses, so non-live states leave the
      // column untouched (null).
      const liveAt = spec.state === "live" ? spec.startsAt : undefined;

      // Upsert the event by its stable slug so re-runs refresh the instant + state
      // in place (no duplicate rows, no table truncation — branch-safe).
      const [row] = await db
        .insert(events)
        .values({
          slug: spec.slug,
          title: spec.title,
          school: spec.school,
          startsAt: spec.startsAt,
          durationMin: spec.durationMin,
          description: spec.description,
          specialties: spec.specialties,
          partnerRef: spec.partnerRef,
          state: spec.state,
          origin: spec.origin ?? "platform",
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
            state: spec.state,
            origin: spec.origin ?? "platform",
            liveAt,
            updatedAt: new Date(),
          },
        })
        .returning({ id: events.id });

      // #1278 — reconcile this event's speaker list instead of replacing it
      // wholesale: the seed is re-run constantly, and a delete-then-insert would
      // physically destroy retained rows on every run (ADR-0003 design §3.6
      // rule 1). Re-running with an unchanged spec is a no-op on the stored rows.
      await reconcileEventSpeakers(
        db,
        row.id,
        spec.speakers.map((s, position) => ({
          position,
          name: s.name,
          regalia: s.regalia,
        })),
      );

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

      // 014 EARS-24/26 (#1741): upsert the fixture's PUBLISHED recording on the
      // LD-1 at-most-one-active-per-kind slot. Keyed on (event, kind) among
      // non-retired rows, exactly like the product path, so a re-run refreshes
      // the same row instead of colliding with its own previous one.
      if (spec.recording) {
        const [existing] = await db
          .select({ id: eventRecordings.id })
          .from(eventRecordings)
          .where(
            and(
              eq(eventRecordings.eventId, row.id),
              eq(eventRecordings.kind, "full"),
              isNull(eventRecordings.deletedAt),
            ),
          );
        const values = {
          provider: spec.recording.provider,
          embedRef: spec.recording.embedRef,
          durationSec: spec.recording.durationSec,
          status: "published" as const,
          // The table's `published ⇒ first_published_at IS NOT NULL` check is a
          // product invariant, so the fixture satisfies it rather than working
          // around it: the archive эфир's cut was published when it was seeded.
          firstPublishedAt: new Date(),
          updatedAt: new Date(),
        };
        if (existing) {
          await db
            .update(eventRecordings)
            .set(values)
            .where(eq(eventRecordings.id, existing.id));
        } else {
          await db
            .insert(eventRecordings)
            .values({ ...values, eventId: row.id, kind: "full" });
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
      // The happy-path live room for the EARS-3 chat + EARS-4 heartbeat E2E.
      E2E_ROOM_SLUG_LIVE: "seed-005-live",
    },
  };
  process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(
      `[seed:events] FAILED — ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    process.exit(1);
  });
