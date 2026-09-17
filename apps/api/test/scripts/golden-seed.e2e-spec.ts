import { randomUUID } from "node:crypto";
import { createDrizzle, registrations, users, events } from "@ds/db";
import {
  buildGoldenDataset,
  golden,
  goldenUuid,
  GOLDEN_GROUP,
  GOLDEN_IDP_ACCOUNTS,
  isGoldenUuid,
  resolveGoldenSubjects,
  seedGolden,
} from "../../../../packages/db/src/seed/golden/index.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// Runs in api-e2e (real migrated PostgreSQL), not the DB-less @ds/db unit job.
// Every fixture is rolled back; no shared golden row survives this suite.
describe("golden seed re-pinning (#2262)", () => {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required by the e2e harness");
  const { db, pool } = createDrizzle(process.env.DATABASE_URL);
  const subjects = resolveGoldenSubjects(
    Object.fromEntries(
      GOLDEN_IDP_ACCOUNTS.map((account, i) => [
        account.subjectEnvVar,
        `2262-subject-${i}`,
      ]),
    ),
  );
  const firstPin = "2026-09-16T08:00:00.000Z";
  const laterPin = "2026-09-17T08:00:00.000Z";
  const rollback = new Error("2262 fixture rollback");
  afterAll(() => pool.end());

  it("EARS-1: re-seeds a day later like a fresh registration plan and retains non-golden data", async () => {
    let fresh: (typeof registrations.$inferSelect)[] = [];
    // A fresh seed is the reference, including defaults and null columns.
    await db
      .transaction(async (tx) => {
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: laterPin } });
        fresh = (
          await tx.select().from(registrations).orderBy(registrations.id)
        ).filter((row) => isGoldenUuid(row.id));
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error.cause ?? error;
      });
    await db
      .transaction(async (tx) => {
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: firstPin } });
        const unrelatedUser = randomUUID();
        await tx.insert(users).values({
          id: unrelatedUser,
          zitadelSub: unrelatedUser,
          email: `${unrelatedUser}@example.test`,
        });
        const [userBefore] = await tx
          .select()
          .from(users)
          .where(eq(users.id, unrelatedUser));
        const ordinary = await tx
          .insert(registrations)
          .values([
            {
              id: randomUUID(),
              userId: unrelatedUser,
              eventId: golden.events.live.id,
            },
            {
              id: randomUUID(),
              userId: golden.doctors.verifiedCardiologist.id,
              eventId: golden.events.hidden.id,
            },
          ])
          .returning();
        // No inbound FK can cascade-delete non-golden child data. If the schema
        // grows such a relation, revisiting this staging replacement is required.
        const inbound = await tx.execute(
          sql`select conname from pg_constraint where contype = 'f' and confrelid = 'registrations'::regclass`,
        );
        expect(inbound.rows).toEqual([]);
        const before = await tx
          .select()
          .from(registrations)
          .orderBy(registrations.id);
        const newPair = fresh.find(
          (row) =>
            !before.some(
              (old) => old.userId === row.userId && old.eventId === row.eventId,
            ),
        );
        expect(newPair).toBeDefined();
        // A product-created holder of a newly planned pair must not be stolen.
        // The seed's savepoint restores even the golden rows it already deleted.
        await tx
          .transaction(async (conflictTx) => {
            await conflictTx
              .insert(registrations)
              .values({ ...newPair!, id: randomUUID() });
            const conflictBefore = await conflictTx
              .select()
              .from(registrations)
              .orderBy(registrations.id);
            await expect(
              seedGolden(conflictTx, {
                subjects,
                env: { GOLDEN_NOW: laterPin },
              }),
            ).rejects.toMatchObject({
              cause: {
                code: "23505",
                constraint: "registrations_user_id_event_id_unique",
              },
            });
            expect(
              await conflictTx
                .select()
                .from(registrations)
                .orderBy(registrations.id),
            ).toEqual(conflictBefore);
            throw rollback;
          })
          .catch((error) => {
            if (error !== rollback) throw error.cause ?? error;
          });
        // An obsolete volume ordinal is seed-owned too; a smaller later plan
        // must not leave it behind. Named and ordinary IDs above remain intact.
        await tx
          .insert(registrations)
          .values({
            id: goldenUuid(GOLDEN_GROUP.registrations, 9999),
            userId: golden.doctors.mfaEnrolled.id,
            eventId: golden.events.hidden.id,
          });
        // The prior pin changes which pair each ordinal holds: the old executor
        // fails here with registrations_user_id_event_id_unique (SQLSTATE 23505).
        const result = await seedGolden(tx, {
          subjects,
          env: { GOLDEN_NOW: laterPin },
        });
        expect(result.now).toBe(laterPin);
        const rows = await tx
          .select()
          .from(registrations)
          .orderBy(registrations.id);
        expect(rows.filter((row) => isGoldenUuid(row.id))).toEqual(fresh);
        for (const row of ordinary)
          expect(rows.find((candidate) => candidate.id === row.id)).toEqual(
            row,
          );
        expect(
          (await tx.select().from(users).where(eq(users.id, unrelatedUser)))[0],
        ).toEqual(userBefore);
        const [live] = await tx
          .select()
          .from(events)
          .where(eq(events.id, golden.events.live.id));
        const plannedLive = buildGoldenDataset(
          new Date(laterPin),
          subjects,
        ).events.find((row) => row.id === golden.events.live.id);
        expect(live?.startsAt).toEqual(plannedLive?.startsAt);
        expect(live?.state).toBe("live");
        // An unchanged pin remains idempotent too.
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: laterPin } });
        expect(
          await tx.select().from(registrations).orderBy(registrations.id),
        ).toEqual(rows);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error.cause ?? error;
      });
  }, 120_000);
});
