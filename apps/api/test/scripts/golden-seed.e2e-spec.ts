import { randomUUID } from "node:crypto";
import {
  createDrizzle,
  directions,
  eventDirections,
  eventRecordings,
  events,
  registrationAttendance,
  registrations,
  users,
} from "@ds/db";
import {
  buildGoldenDataset,
  golden,
  goldenUuid,
  GOLDEN_GROUP,
  GOLDEN_IDP_ACCOUNTS,
  GOLDEN_VOLUME_ORDINAL_BASE,
  isGoldenUuid,
  isGoldenVolumeUuid,
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
  // #2351 — the pin that reproduces the stage failure of 2026-09-22 verbatim,
  // down to the colliding pair. `event_directions` walks two contiguous
  // direction slots per эфир over two counters split by
  // `published && startsAt > now`, so every day the pin passes an эфир's start
  // re-phases the walk and moves pairs between positional ordinals. Six days
  // move one DOWN — onto an ordinal the same statement has not rewritten yet.
  // The one-day `laterPin` above happens to move none, which is why EARS-1
  // never saw this class here.
  const reshuffledPin = "2026-09-22T08:00:00.000Z";
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
        // No inbound FK can cascade-delete non-golden child data. Exactly two
        // children reference `registrations`: the per-day attendance marks of
        // 044 EARS-34 (#2381) and the congress submissions of 046 EARS-5
        // (#2433), both `ON DELETE RESTRICT` (#1278), which the plan declares
        // as the replacement's ordered child cleanup
        // (`volumeNamespaceChildren`). Any further relation requires
        // revisiting this staging replacement.
        const inbound = await tx.execute(
          sql`select conname, confdeltype from pg_constraint where contype = 'f' and confrelid = 'registrations'::regclass order by conname`,
        );
        expect(inbound.rows).toEqual([
          {
            conname: "congress_submissions_registration_id_registrations_id_fk",
            confdeltype: "r",
          },
          {
            conname:
              "registration_attendance_registration_id_registrations_id_fk",
            confdeltype: "r",
          },
        ]);
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
        await tx.insert(registrations).values({
          id: goldenUuid(GOLDEN_GROUP.registrations, 9999),
          userId: golden.doctors.mfaEnrolled.id,
          eventId: golden.events.hidden.id,
        });
        // #2381 — an attendance mark on a replaced golden registration goes
        // with it (ordered child cleanup, not a restrict failure); a mark on a
        // product-created registration survives the re-seed untouched.
        await tx.insert(registrationAttendance).values([
          {
            registrationId: goldenUuid(GOLDEN_GROUP.registrations, 9999),
            day: "2027-04-23",
            present: true,
          },
          { registrationId: ordinary[0]!.id, day: "2027-04-23", present: true },
        ]);
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
        expect(await tx.select().from(registrationAttendance)).toEqual([
          { registrationId: ordinary[0]!.id, day: "2027-04-23", present: true },
        ]);
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

  it("EARS-2: re-seeds the persistent database at a pin one season-step later without event_directions pair collisions", async () => {
    let fresh: (typeof eventDirections.$inferSelect)[] = [];
    let freshRecordings: (typeof eventRecordings.$inferSelect)[] = [];
    // The reference: what a never-seeded database holds at the later pin.
    await db
      .transaction(async (tx) => {
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: reshuffledPin } });
        fresh = (
          await tx.select().from(eventDirections).orderBy(eventDirections.id)
        ).filter((row) => isGoldenUuid(row.id));
        // `event_recordings` walks with the pin for its own reason (a running
        // ordinal over the recorded эфиры) and collides on
        // `event_recordings_event_kind_active_uniq` — the same class, so the
        // same declaration, and the same reference comparison. VOLUME rows
        // only: a NAMED recording carries `first_published_at`, which the
        // set-once trigger pins to the FIRST build, so an in-place re-pin
        // deliberately keeps an instant a fresh build would compute anew.
        freshRecordings = (
          await tx.select().from(eventRecordings).orderBy(eventRecordings.id)
        ).filter((row) => isGoldenVolumeUuid(row.id));
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error.cause ?? error;
      });
    expect(fresh.some((row) => isGoldenVolumeUuid(row.id))).toBe(true);

    await db
      .transaction(async (tx) => {
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: firstPin } });
        // A classification the product created: its own direction, so the pair
        // is the seed's to collide with only if the replacement overreaches.
        const ordinaryDirection = randomUUID();
        await tx.insert(directions).values({
          id: ordinaryDirection,
          slug: `ordinary-direction-${ordinaryDirection}`,
          title: "Направление вне golden",
        });
        const [ordinaryLink] = await tx
          .insert(eventDirections)
          .values({
            id: randomUUID(),
            eventId: golden.events.hidden.id,
            directionId: ordinaryDirection,
          })
          .returning();
        // No inbound FK on either table this test replaces: the replacement
        // cannot cascade into child rows nor abort on `restrict`. A future child
        // table invalidates the step's `replacesVolumeNamespace` declaration,
        // and this is where it surfaces.
        const inbound = await tx.execute(
          sql`select conname from pg_constraint where contype = 'f' and confrelid in ('event_directions'::regclass, 'event_recordings'::regclass)`,
        );
        expect(inbound.rows).toEqual([]);
        const namedBefore = (
          await tx.select().from(eventDirections).orderBy(eventDirections.id)
        )
          .filter((row) => isGoldenUuid(row.id) && !isGoldenVolumeUuid(row.id))
          .map((row) => row.id);
        expect(namedBefore.length).toBeGreaterThan(0);

        // The moved pin hands ordinal …0a22 the pair a HIGHER ordinal (…0a23)
        // still holds, and `ON CONFLICT (id)` rewrites in ascending id order:
        // the old executor fails here with event_directions_pair_key (23505).
        const result = await seedGolden(tx, {
          subjects,
          env: { GOLDEN_NOW: reshuffledPin },
        });
        expect(result.now).toBe(reshuffledPin);

        const rows = await tx
          .select()
          .from(eventDirections)
          .orderBy(eventDirections.id);
        // Re-seeded in place == freshly seeded, row for row.
        expect(rows.filter((row) => isGoldenUuid(row.id))).toEqual(fresh);
        expect(
          (
            await tx.select().from(eventRecordings).orderBy(eventRecordings.id)
          ).filter((row) => isGoldenVolumeUuid(row.id)),
        ).toEqual(freshRecordings);
        // Named catalogue rows are BELOW the volume base: upserted by id, never
        // inside the replaced range.
        expect(
          rows
            .filter(
              (row) => isGoldenUuid(row.id) && !isGoldenVolumeUuid(row.id),
            )
            .map((row) => row.id),
        ).toEqual(namedBefore);
        expect(Number.parseInt(namedBefore[0]!.slice(-12), 16)).toBeLessThan(
          GOLDEN_VOLUME_ORDINAL_BASE,
        );
        // The product's own row survives untouched.
        expect(rows.find((row) => row.id === ordinaryLink!.id)).toEqual(
          ordinaryLink,
        );
        // And the moved pin stays idempotent on a third run.
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: reshuffledPin } });
        expect(
          await tx.select().from(eventDirections).orderBy(eventDirections.id),
        ).toEqual(rows);
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error.cause ?? error;
      });
  }, 120_000);
});

// #2875 — a long-lived slot DB already mirrors the golden IdP accounts before the
// golden seed ever writes them: every slot api runs the reconcile sweep against
// the SHARED stage Zitadel (`ReconcileService.sweep` → `UserMirrorService.upsert`),
// which inserts a fresh-uuid `users` row per enumerated account. The seed must
// adopt that row for the golden identity instead of tripping
// `users_email_unique` / `users_zitadel_sub_unique`.
describe("golden seed adopts IdP-mirrored rows of a golden identity (#2875)", () => {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required by the e2e harness");
  const { db, pool } = createDrizzle(process.env.DATABASE_URL);
  const subjects = resolveGoldenSubjects(
    Object.fromEntries(
      GOLDEN_IDP_ACCOUNTS.map((account, i) => [
        account.subjectEnvVar,
        `2875-subject-${i}`,
      ]),
    ),
  );
  const pin = "2026-10-13T08:00:00.000Z";
  const poolEmail = "golden.doctor.verified.w1@example.test";
  const rollback = new Error("2875 fixture rollback");
  afterAll(() => pool.end());

  const goldenPoolUser = () => {
    const row = buildGoldenDataset(new Date(pin), subjects).users.find(
      (u) => u.email === poolEmail,
    );
    if (!row?.id || !row.zitadelSub) throw new Error("no golden pool user");
    return { id: row.id, zitadelSub: row.zitadelSub };
  };

  it("#2875: seeds over a reconcile-mirrored row carrying the golden email and subject under a non-golden id", async () => {
    const golden = goldenPoolUser();
    await db
      .transaction(async (tx) => {
        // Exactly what the sweep writes for a never-seen account (user-mirror
        // insert): its own uuid, the sub, the email, `doctor_guest`.
        const strayId = randomUUID();
        await tx.insert(users).values({
          id: strayId,
          zitadelSub: golden.zitadelSub,
          email: poolEmail,
          emailVerified: true,
          role: "doctor_guest",
        });
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: pin } });
        const rows = await tx
          .select()
          .from(users)
          .where(eq(users.zitadelSub, golden.zitadelSub));
        expect(rows.map((r) => [r.id, r.email])).toEqual([
          [golden.id, poolEmail],
        ]);
        expect(
          await tx.select().from(users).where(eq(users.id, strayId)),
        ).toEqual([]);
        // Idempotent on a re-run.
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: pin } });
        throw rollback;
      })
      .catch((error) => {
        if (error !== rollback) throw error.cause ?? error;
      });
  }, 120_000);

  it("#2875: refuses, naming the identity, when the mirrored row already carries product data", async () => {
    const golden = goldenPoolUser();
    let failure: unknown;
    await db
      .transaction(async (tx) => {
        const strayId = randomUUID();
        await tx.insert(users).values({
          id: strayId,
          zitadelSub: golden.zitadelSub,
          email: poolEmail,
          emailVerified: true,
          role: "doctor_guest",
        });
        await tx.execute(sql`
          insert into consent_records (user_id, purpose, version)
          values (${strayId}, '2875-fixture', 'v1')
        `);
        await seedGolden(tx, { subjects, env: { GOLDEN_NOW: pin } });
        throw rollback;
      })
      .catch((error) => {
        failure = error;
      });
    expect(failure).not.toBe(rollback);
    const message = String((failure as Error)?.message);
    expect(message).toContain("cannot adopt");
    expect(message).toContain(poolEmail);
  }, 120_000);
});
