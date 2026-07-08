#!/usr/bin/env tsx
/**
 * 005 portal-integration fixture seed (#574). Seeds one event in EACH lifecycle
 * state the portal renders + E2E-drives — `published` (upcoming), `live`,
 * `ended`, `archived` — plus ordered speakers, so the registered-state overlay,
 * the one-tap / guest-through-auth registration flows, «мои события», and the
 * ended/archived gating can be driven against the LIVE dev stand.
 *
 * This is the tracked 005↔007 fixture seam (parent #564): until feature 007's
 * admin authoring + lifecycle transitions drive these states, this script stands
 * in. "Done against the real dependency" = the journey runs on events authored +
 * transitioned through 007, at which point this seed is retired. It writes the
 * 007-owned `events` write model directly (a fixture, not a product path) — never
 * a hack in a runtime handler.
 *
 * Idempotent: upserts by the stable `seed-005-*` slug, so re-running refreshes
 * the instants (times are relative to `now`) without duplicating rows. It ONLY
 * touches its own `seed-005-*` slugs — it never truncates the table or a branch
 * DB, so it is safe on a shared/branch stand.
 *
 * Run with the branch DB URL injected (never edit `.env.local`; see
 * `.claude/rules/dev-stand.md` / `reference_local_api_portal_live_run_recipe`):
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   DATABASE_URL=postgres://…/ds_dev_574 pnpm --filter @ds/api seed:events
 *
 * Prints a JSON map of `{ state: slug }` (its stdout contract) so a caller / E2E
 * env wiring can pick the slug for each state. Exits non-zero on failure.
 */
import { createDrizzle, events, eventSpeakers } from "@ds/db";
import { eq } from "drizzle-orm";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface SeedSpec {
  readonly slug: string;
  readonly state: "published" | "live" | "ended" | "archived";
  readonly title: string;
  readonly school: string;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly description: string;
  readonly specialties: string[];
  readonly partnerRef: string;
  readonly speakers: { readonly name: string; readonly regalia: string }[];
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
    {
      slug: "seed-005-archived",
      state: "archived",
      title: "Архив: базовая ЭКГ для терапевта",
      school: "Школа терапии",
      startsAt: new Date(now - 30 * DAY),
      durationMin: 60,
      description:
        "Эфир перенесён в архив — регистрация и запись недоступны. Основы интерпретации ЭКГ.",
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
            updatedAt: new Date(),
          },
        })
        .returning({ id: events.id });

      // Replace this event's speakers wholesale (composite PK (event_id, position)
      // makes a plain re-insert conflict), keeping the ordered list deterministic.
      await db.delete(eventSpeakers).where(eq(eventSpeakers.eventId, row.id));
      await db.insert(eventSpeakers).values(
        spec.speakers.map((s, position) => ({
          eventId: row.id,
          position,
          name: s.name,
          regalia: s.regalia,
        })),
      );

      result[spec.slug] = spec.state;
    }
  } finally {
    await pool.end();
  }

  // The machine-readable result is the script's stdout contract.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
