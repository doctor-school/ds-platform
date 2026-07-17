import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, events } from "@ds/db";
import { eq } from "drizzle-orm";
import { EventsRepository } from "../../src/events/events.repository.js";

// 010 — Universal edit audit, EARS-5 (Issue #1088): the API-path actor
// guarantee. Every authenticated mutating API path runs its domain writes
// inside the EARS-3 `withAuditContext` wrapper, so a `data.*` ledger row
// originating from an authenticated request ALWAYS carries a non-NULL actor sub
// and a concrete (non-`db-direct`) source. An authenticated mutation surfacing
// as `db-direct` is a defect.
//
// v1 is test-enforced (010-design §3, EARS-5; runtime interceptor deferred):
// the flagship authenticated mutation — the events-admin lifecycle transition
// (`EventsRepository.updateStateWithAudit`) — is driven end-to-end and its
// trigger row asserted attributed; a bypassing (unwrapped) write is pinned to
// prove the wrapper is the load-bearing attribution seam.

interface UpdateTrailRow {
  subject_id: string | null;
  metadata: { source: string; diff: Record<string, unknown> };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "010 EARS-5 — API-path actor guarantee (e2e)",
  () => {
    let handle: ReturnType<typeof createDrizzle>;
    let repo: EventsRepository;

    beforeAll(() => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 3 });
      repo = new EventsRepository(handle.db);
    });

    afterAll(async () => {
      await handle.pool.end();
    });

    async function seedDraftEvent(): Promise<string> {
      const [row] = await handle.db
        .insert(events)
        .values({
          slug: `audit-guarantee-${randomUUID()}`,
          title: "audit guarantee event",
          school: "audit-guarantee-e2e",
          startsAt: new Date(Date.now() + 86_400_000),
          durationMin: 60,
        })
        .returning({ id: events.id });
      return row!.id;
    }

    async function updateTrailRow(
      id: string,
    ): Promise<UpdateTrailRow | undefined> {
      const { rows } = await handle.pool.query<UpdateTrailRow>(
        `SELECT subject_id, metadata
         FROM audit_ledger
         WHERE event_type = 'data.events.update' AND metadata -> 'pk' ->> 'id' = $1`,
        [id],
      );
      return rows[0];
    }

    it("010 EARS-5: an authenticated admin transition through the wired repository yields an attributed data.events.update row (non-NULL actor, non-db-direct source)", async () => {
      const actorSub = `audit-guarantee-actor-${randomUUID()}`;
      const id = await seedDraftEvent();

      await repo.updateStateWithAudit(id, "published", {
        eventType: "event.published",
        subjectId: actorSub,
        source: "admin-ui",
        from: "draft",
      });

      const trail = await updateTrailRow(id);
      expect(trail).toBeDefined();
      // The guarantee: authenticated mutation ⇒ real actor + concrete source.
      expect(trail!.subject_id).toBe(actorSub);
      expect(trail!.metadata.source).toBe("admin-ui");
      expect(trail!.metadata.source).not.toBe("db-direct");
    });

    it("010 EARS-5: the wrapper is load-bearing — a bypassing (unwrapped) update surfaces as db-direct, so a handler that skips the seam is caught by the trail", async () => {
      const id = await seedDraftEvent();
      // Direct, context-less update: the seam is bypassed → db-direct, NULL actor.
      await handle.db
        .update(events)
        .set({ title: "unwrapped retitle", updatedAt: new Date() })
        .where(eq(events.id, id));

      const trail = await updateTrailRow(id);
      expect(trail).toBeDefined();
      expect(trail!.metadata.source).toBe("db-direct");
      expect(trail!.subject_id).toBeNull();
    });
  },
);
