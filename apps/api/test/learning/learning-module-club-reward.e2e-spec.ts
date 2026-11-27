import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  bootHarness,
  buildCourse,
  setRules,
  staffSession,
  type Harness,
  type Problem,
} from "./harness.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// 023 EARS-1, EARS-2, EARS-27, EARS-28 (#4282) — the module club and the
// module reward over the admin API: a module's club is an optional live 020
// event (set, cleared, refused when unknown or removed) read back with the
// event's title; `module.reward` is a 024 setting (platform seed `points`,
// set at the course and the module, refused at the school) resolved with its
// source; on a published course a `module.reward` or `course.clubInCompletion`
// change takes `learning_rules_editor` and is a recorded rule change — one 010
// audit row per change.

type ModuleRead = {
  id: string;
  title: string;
  clubEventId: string | null;
  clubEvent: { id: string; title: string; startsAt: string } | null;
  version: number;
};
type Composition = { modules: ModuleRead[] };
type Rules = {
  layerVersion: number;
  values: Record<string, unknown>;
  effective: { key: string; value: unknown; level: string }[];
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "023 learning — the module club and the module reward (e2e)",
  () => {
    let h: Harness;
    let adminOnly: string;
    let editorOnly: string;

    beforeAll(async () => {
      h = await bootHarness();
      adminOnly = await staffSession(h, ["platform_admin"]);
      editorOnly = await staffSession(h, ["learning_rules_editor"]);
    });

    afterAll(async () => {
      await h?.close();
    });

    /** A 020 event row (raw fixture); `retired` = removed (record_status + deleted_at). */
    const seedEvent = async (
      title: string,
      retired = false,
    ): Promise<string> => {
      const id = randomUUID();
      await h.pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience, record_status, deleted_at)
         VALUES ($1, $2, $3, 'Школа', '2027-02-01T15:00:00Z', 60, 'draft', ${eventClassificationSql("doctors")}, $4, $5)`,
        [
          id,
          `club-${id.slice(0, 8)}`,
          title,
          retired ? "retired" : "active",
          retired ? new Date() : null,
        ],
      );
      return id;
    };

    const moduleOf = async (courseId: string, moduleId: string) => {
      const r = await admin<Composition>(h, "GET", `/courses/${courseId}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.modules.find((m) => m.id === moduleId)!;
    };

    const patchModule = (
      moduleId: string,
      version: number,
      payload: Record<string, unknown>,
    ) =>
      admin<ModuleRead & Problem>(h, "PATCH", `/modules/${moduleId}`, {
        payload,
        ifMatch: `W/"${version}"`,
      });

    const auditRows = async (event: string, id: string) =>
      (
        await h.pool.query<{ subject_id: string | null }>(
          `SELECT subject_id FROM audit_ledger
            WHERE event_type = $1 AND metadata -> 'pk' ->> 'id' = $2`,
          [event, id],
        )
      ).rows;

    const layerId = async (kind: string, id: string) =>
      (
        await h.pool.query<{ id: string }>(
          "SELECT id FROM learning_rule_layers WHERE scope_kind = $1 AND scope_id = $2",
          [kind, id],
        )
      ).rows[0]!.id;

    const effective = async (kind: string, id: string, key: string) => {
      const r = await admin<Rules>(h, "GET", `/rules/${kind}/${id}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.effective.find((e) => e.key === key);
    };

    it("023 EARS-1: PATCH /modules/{id} sets the module's club to a live 020 event and clears it with null", async () => {
      const c = await buildCourse(h, { publish: false });
      const eventId = await seedEvent("Клуб: разбор ЭКГ");
      const m0 = await moduleOf(c.courseId, c.moduleId);
      expect(m0.clubEventId).toBeNull();
      expect(m0.clubEvent).toBeNull();

      const set = await patchModule(c.moduleId, m0.version, {
        clubEventId: eventId,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(set.body.clubEventId).toBe(eventId);
      expect(set.body.clubEvent).toEqual({
        id: eventId,
        title: "Клуб: разбор ЭКГ",
        startsAt: "2027-02-01T15:00:00.000Z",
        removed: false,
      });
      // The title is left as it was when the patch names only the club.
      expect(set.body.title).toBe(m0.title);

      const cleared = await patchModule(c.moduleId, set.body.version, {
        clubEventId: null,
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(cleared.body.clubEventId).toBeNull();
      expect(cleared.body.clubEvent).toBeNull();
      // One 010 change-audit row per change.
      expect(
        await auditRows("data.learning_modules.update", c.moduleId),
      ).toHaveLength(2);
    });

    it("023 EARS-1: a club event that does not exist or was removed is refused 400 naming clubEventId; nothing changes", async () => {
      const c = await buildCourse(h, { publish: false });
      const removed = await seedEvent("Клуб снят", true);
      const m0 = await moduleOf(c.courseId, c.moduleId);
      for (const clubEventId of [randomUUID(), removed]) {
        const r = await patchModule(c.moduleId, m0.version, { clubEventId });
        expect(r.status, JSON.stringify(r.body)).toBe(400);
        expect(r.body.errors?.map((e) => e.path)).toContain("clubEventId");
      }
      const after = await moduleOf(c.courseId, c.moduleId);
      expect(after.version).toBe(m0.version);
      expect(after.clubEventId).toBeNull();
    });

    it("023 EARS-1: a club event removed after it was set reads as removed, so staff re-pick it", async () => {
      const c = await buildCourse(h, { publish: false });
      const eventId = await seedEvent("Клуб, который снимут");
      const m0 = await moduleOf(c.courseId, c.moduleId);
      expect(
        (await patchModule(c.moduleId, m0.version, { clubEventId: eventId }))
          .status,
      ).toBe(200);
      await h.pool.query(
        "UPDATE events SET record_status = 'retired', deleted_at = now() WHERE id = $1",
        [eventId],
      );
      const after = await moduleOf(c.courseId, c.moduleId);
      expect(after.clubEventId).toBe(eventId);
      expect(after.clubEvent).toEqual({
        id: eventId,
        title: "Клуб, который снимут",
        startsAt: "2027-02-01T15:00:00.000Z",
        removed: true,
      });
    });

    it("023 EARS-27: the course composition reads each module's club with its event's title; a club-less module reads none", async () => {
      const c = await buildCourse(h, { publish: false });
      const second = await admin<ModuleRead>(h, "POST", "/modules", {
        payload: { courseId: c.courseId, title: "Без клуба" },
      });
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      expect(second.body.clubEventId).toBeNull();
      const eventId = await seedEvent("Клуб модуля 1");
      const m0 = await moduleOf(c.courseId, c.moduleId);
      expect(
        (await patchModule(c.moduleId, m0.version, { clubEventId: eventId }))
          .status,
      ).toBe(200);
      const composition = await admin<Composition>(
        h,
        "GET",
        `/courses/${c.courseId}`,
      );
      expect(
        composition.body.modules.map((m) => [m.id, m.clubEvent?.title ?? null]),
      ).toEqual([
        [c.moduleId, "Клуб модуля 1"],
        [second.body.id, null],
      ]);
    });

    it("023 EARS-2: `module.reward` resolves from the platform seed `points`, a course value over it and a module value over the course", async () => {
      const c = await buildCourse(h, { publish: false });
      expect(await effective("module", c.moduleId, "module.reward")).toMatchObject(
        { value: "points", level: "platform" },
      );
      expect(
        (await setRules(h, "course", c.courseId, { "module.reward": "document" }))
          .status,
      ).toBe(200);
      expect(await effective("module", c.moduleId, "module.reward")).toMatchObject(
        { value: "document", level: "course" },
      );
      const own = await setRules(h, "module", c.moduleId, {
        "module.reward": "both",
      });
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(await effective("module", c.moduleId, "module.reward")).toMatchObject(
        { value: "both", level: "module" },
      );
      // No value of it changes the course's completion rule.
      expect(await effective("course", c.courseId, "completion.course")).toMatchObject(
        { value: { condition: "lessons-done" }, level: "platform" },
      );
    });

    it("023 EARS-2: `module.reward` is refused at the school layer and outside its values", async () => {
      const c = await buildCourse(h, { publish: false });
      const school = await setRules(h, "school", c.schoolId, {
        "module.reward": "document",
      });
      expect(school.status).toBe(400);
      expect((school.body as Problem).errors?.map((e) => e.path)).toContain(
        "values.module.reward",
      );
      const bad = await setRules(h, "module", c.moduleId, {
        "module.reward": "coins",
      });
      expect(bad.status).toBe(400);
      expect(
        (bad.body as Problem).errors?.some((e) =>
          e.path.startsWith("values.module.reward"),
        ),
      ).toBe(true);
    });

    it("023 EARS-28: on a published course `module.reward` and `course.clubInCompletion` take `learning_rules_editor` — a recorded rule change and one audit row each", async () => {
      const c = await buildCourse(h);
      for (const [kind, id, values] of [
        ["module", c.moduleId, { "module.reward": "both" }],
        ["course", c.courseId, { "course.clubInCompletion": true }],
      ] as const) {
        const refused = await setRules(h, kind, id, values, { sid: adminOnly });
        expect(refused.status).toBe(403);
        expect((refused.body as Problem).errorCode).toBe(
          "LEARNING_RULES_EDITOR_REQUIRED",
        );
        const ok = await setRules(h, kind, id, values, { sid: editorOnly });
        expect(ok.status, JSON.stringify(ok.body)).toBe(200);
        const [key, value] = Object.entries(values)[0]!;
        expect(await effective(kind, id, key)).toMatchObject({
          value,
          level: kind,
        });
        const changes = await h.pool.query<{ after: Record<string, unknown> }>(
          `SELECT after FROM learning_rule_changes
            WHERE scope_kind = $1 AND scope_id = $2`,
          [kind, id],
        );
        expect(changes.rows).toHaveLength(1);
        expect(changes.rows[0]!.after).toMatchObject(values);
        const layer = await layerId(kind, id);
        expect(
          (await auditRows("data.learning_rule_layers.insert", layer)).length +
            (await auditRows("data.learning_rule_layers.update", layer)).length,
        ).toBe(1);
      }
    });
  },
);
