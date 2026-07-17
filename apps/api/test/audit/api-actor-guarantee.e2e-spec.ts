import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, events, users } from "@ds/db";
import type { AuditSource } from "@ds/db";
import { auditContextStore } from "../../src/audit/audit-context.js";
import { EventsRepository } from "../../src/events/events.repository.js";
import { MeRepository } from "../../src/me/me.repository.js";
import { RegistrationRepository } from "../../src/registration/registration.repository.js";

// 010 — Universal edit audit, EARS-5 (Issue #1088): the API-path actor
// guarantee, as a SWEEP over every authenticated mutating endpoint whose write
// touches an audited table. Each repository write path now adopts
// `withRequestAuditContext`, which reads the request-scoped audit context the
// global `AuditContextInterceptor` populates. Here we drive the REAL repository
// methods inside `auditContextStore.run(...)` (the interceptor's effect, minus
// the HTTP boot; the interceptor's own route→source derivation is unit-tested in
// audit-context.interceptor.spec.ts) and assert every resulting `data.*` ledger
// row carries a non-NULL actor + a concrete, non-`db-direct` source. A bypassing
// (context-less) write is pinned to `db-direct` so a handler that skips the seam
// is caught by the trail.
//
// presence_beats (room heartbeat/chat) is design-§5 allowlisted — no capture
// trigger — so those endpoints produce no `data.*` row and are out of scope.

interface TrailRow {
  subject_id: string | null;
  metadata: { source: string };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "010 EARS-5 — API-path actor guarantee (endpoint sweep, e2e)",
  () => {
    let handle: ReturnType<typeof createDrizzle>;
    let eventsRepo: EventsRepository;
    let meRepo: MeRepository;
    let registrationRepo: RegistrationRepository;

    beforeAll(() => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 4 });
      eventsRepo = new EventsRepository(handle.db);
      meRepo = new MeRepository(handle.db);
      registrationRepo = new RegistrationRepository(handle.db);
    });

    afterAll(async () => {
      await handle.pool.end();
    });

    function eventValues() {
      return {
        slug: `audit-sweep-${randomUUID()}`,
        title: "audit sweep event",
        school: "audit-sweep-e2e",
        startsAt: new Date(Date.now() + 86_400_000),
        durationMin: 60,
      };
    }

    async function seedEvent(): Promise<string> {
      const [row] = await handle.db
        .insert(events)
        .values(eventValues())
        .returning({ id: events.id });
      return row!.id;
    }

    async function seedUserWithSub(sub: string): Promise<string> {
      const [row] = await handle.db
        .insert(users)
        .values({ zitadelSub: sub, email: `${sub}@example.test` })
        .returning({ id: users.id });
      return row!.id;
    }

    /** The single data.<table>.<op> trail row for a pk value, or undefined. */
    async function trail(
      table: string,
      op: string,
      pkColumn: string,
      pkValue: string,
    ): Promise<TrailRow | undefined> {
      const { rows } = await handle.pool.query<TrailRow>(
        `SELECT subject_id, metadata
         FROM audit_ledger
         WHERE event_type = $1 AND metadata -> 'pk' ->> $2 = $3`,
        [`data.${table}.${op}`, pkColumn, pkValue],
      );
      return rows[0];
    }

    // Each case runs one real authenticated mutation (actorSub in scope) and
    // returns the trail row it must have produced.
    interface Target {
      table: string;
      op: string;
      pkColumn: string;
      pkValue: string;
    }
    interface SweepCase {
      endpoint: string;
      source: AuditSource;
      run: (actorSub: string) => Promise<Target>;
    }

    const cases: SweepCase[] = [
      {
        endpoint: "POST /v1/admin/events (create)",
        source: "admin-ui",
        run: async () => {
          const created = await eventsRepo.insert(eventValues(), []);
          return {
            table: "events",
            op: "insert",
            pkColumn: "id",
            pkValue: created.event.id,
          };
        },
      },
      {
        endpoint: "POST /v1/admin/events/:id/publish (transition)",
        source: "admin-ui",
        run: async (actorSub) => {
          const id = await seedEvent();
          await eventsRepo.updateStateWithAudit(id, "published", {
            eventType: "event.published",
            subjectId: actorSub,
            from: "draft",
          });
          return { table: "events", op: "update", pkColumn: "id", pkValue: id };
        },
      },
      {
        endpoint: "PUT /v1/admin/events/:id/stream (configureStream)",
        source: "admin-ui",
        run: async () => {
          const id = await seedEvent();
          await eventsRepo.upsertStreamConfig(id, {
            provider: "rutube",
            embedRef: "audit-sweep-embed",
          });
          return {
            table: "stream_config",
            op: "insert",
            pkColumn: "event_id",
            pkValue: id,
          };
        },
      },
      {
        endpoint: "PUT /v1/me/display-name (setDisplayName)",
        source: "portal-api",
        run: async (actorSub) => {
          // The self-scoped write keys on the caller's own sub == the actor.
          const id = await seedUserWithSub(actorSub);
          await meRepo.setDisplayNameBySub(actorSub, "Sweep Name");
          return { table: "users", op: "update", pkColumn: "id", pkValue: id };
        },
      },
      {
        endpoint: "POST /v1/events/:id/registration (register)",
        source: "portal-api",
        run: async (actorSub) => {
          const userId = await seedUserWithSub(actorSub);
          const eventId = await seedEvent();
          const reg = await registrationRepo.upsertRegistration(
            userId,
            eventId,
            actorSub,
          );
          expect(reg.created).toBe(true);
          const { rows } = await handle.pool.query<{ id: string }>(
            `SELECT id FROM registrations WHERE user_id = $1 AND event_id = $2`,
            [userId, eventId],
          );
          return {
            table: "registrations",
            op: "insert",
            pkColumn: "id",
            pkValue: rows[0]!.id,
          };
        },
      },
    ];

    for (const c of cases) {
      it(`010 EARS-5: ${c.endpoint} → attributed data.* row (non-NULL actor, source=${c.source}, never db-direct)`, async () => {
        const actorSub = `audit-sweep-actor-${randomUUID()}`;
        const target = await auditContextStore.run(
          { actorSub, source: c.source },
          () => c.run(actorSub),
        );
        const row = await trail(
          target.table,
          target.op,
          target.pkColumn,
          target.pkValue,
        );
        expect(
          row,
          `${c.endpoint} produced no ${target.table} trail row`,
        ).toBeDefined();
        expect(row!.metadata.source).toBe(c.source);
        expect(row!.metadata.source).not.toBe("db-direct");
        expect(row!.subject_id).toBe(actorSub);
      });
    }

    it("010 EARS-5: a context-less write (seam bypassed, no store) surfaces as db-direct — a handler that skips the wrapper is caught by the trail", async () => {
      const created = await eventsRepo.insert(eventValues(), []);
      const row = await trail("events", "insert", "id", created.event.id);
      expect(row).toBeDefined();
      expect(row!.metadata.source).toBe("db-direct");
      expect(row!.subject_id).toBeNull();
    });
  },
);
