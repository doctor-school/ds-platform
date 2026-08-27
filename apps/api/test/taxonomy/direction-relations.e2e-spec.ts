import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  buildSpecialtyBookSeed,
  DIRECTION_ADJACENCY_WEIGHT_DEFAULT,
} from "@ds/db";
import { DIRECTION_ADJACENCY_KINDS } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

// #1483 (ADR-0016 §2.8; 017-design §5; 017-requirements EARS-8) — the two
// direction reference relations over the REAL stack: Fastify + the 011 admin
// session + Postgres.
//
// The suite's centre of gravity is the LAST test: the TargetingSet-shaped
// traversal 017's targeting resolution (#1484) will run — chosen specialty →
// `direction_specialties` → own directions → `direction_adjacency` (kind +
// weight) → adjacent directions — resolved purely from rows AUTHORED THROUGH THE
// ADMIN API in this file. Nothing is hand-seeded into either table, because
// EARS-8's whole claim is that nothing enters a TargetingSet without a managed
// row an operator authored; a fixture INSERT would prove the query and skip the
// claim.
//
// Specialty ids are resolved by CODE from the boot-seeded closed book
// (`buildSpecialtyBookSeed()`), never by literal id or literal count — the same
// rule `storefront/specialties.e2e-spec.ts` states for the book itself.
//
// Skips when the stand is absent, exactly as the 012 suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "#1483 direction↔specialty links and direction adjacency (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdDirectionIds: string[] = [];
    const createdLinkIds: string[] = [];
    const createdEdgeIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;
    /** Two entries of the closed book, resolved by seeded CODE. */
    let specialtyA: string;
    let specialtyB: string;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function key(): string {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    }

    async function adminSession(): Promise<string> {
      const email = uniqueEmail("rel-admin");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
    }

    /** A doctor-portal (non-admin) session cookie — the 403 probe. */
    async function doctorCookie(): Promise<string> {
      const email = uniqueEmail("rel-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    }

    function adminWrite(idempotencyKey?: string): Record<string, string> {
      return {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey ?? key(),
      };
    }

    function adminRead(): Record<string, string> {
      return { ...device, ...adminHeaders(adminSid) };
    }

    /** Author one direction through the 012 admin surface. */
    async function makeDirection(label: string): Promise<{
      id: string;
      title: string;
      slug: string;
    }> {
      const title = `${label} ${randomUUID().slice(0, 8)}`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/directions",
        headers: adminWrite(),
        payload: { title },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; title: string; slug: string };
      createdDirectionIds.push(body.id);
      return body;
    }

    async function link(
      directionId: string,
      specialtyMinzdravId: string,
    ): Promise<ReturnType<NestFastifyApplication["inject"]>> {
      return app.inject({
        method: "POST",
        url: "/v1/admin/direction-specialties",
        headers: adminWrite(),
        payload: { directionId, specialtyMinzdravId },
      });
    }

    async function linked(
      directionId: string,
      specialtyMinzdravId: string,
    ): Promise<{ id: string; version: number }> {
      const res = await link(directionId, specialtyMinzdravId);
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; version: number };
      createdLinkIds.push(body.id);
      return body;
    }

    async function edge(payload: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/direction-adjacency",
        headers: adminWrite(),
        payload,
      });
    }

    async function edged(
      payload: Record<string, unknown>,
    ): Promise<{ id: string; version: number }> {
      const res = await edge(payload);
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; version: number };
      createdEdgeIds.push(body.id);
      return body;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await adminSession();

      // Two DIFFERENT entries of the closed book, addressed by their seeded
      // codes — the book is boot-seeded and survives a re-seed by `code`.
      const seed = buildSpecialtyBookSeed();
      const codes = [seed[0]!.code, seed[1]!.code];
      const { rows } = await pool.query<{ id: string; code: string }>(
        "SELECT id, code FROM specialties_minzdrav WHERE code = ANY($1)",
        [codes],
      );
      const byCode = new Map(rows.map((r) => [r.code, r.id]));
      specialtyA = byCode.get(codes[0]!)!;
      specialtyB = byCode.get(codes[1]!)!;
      expect(specialtyA).toBeTruthy();
      expect(specialtyB).toBeTruthy();
    }, 90_000);

    afterEach(async () => {
      for (const id of createdEdgeIds.splice(0)) {
        await pool.query("DELETE FROM direction_adjacency WHERE id = $1", [id]);
      }
      for (const id of createdLinkIds.splice(0)) {
        await pool.query("DELETE FROM direction_specialties WHERE id = $1", [
          id,
        ]);
      }
      for (const id of createdDirectionIds.splice(0)) {
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app?.close();
    });

    // ── direction↔specialty links ──────────────────────────────────────────

    it("EARS-8.1: links a direction to a closed-book specialty as one retained active row with an ETag and a Location", async () => {
      const direction = await makeDirection("Кардиология");
      const res = await link(direction.id, specialtyA);
      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      createdLinkIds.push(body.id as string);

      expect(body).toMatchObject({
        directionId: direction.id,
        directionTitle: direction.title,
        specialtyMinzdravId: specialtyA,
        status: "active",
        version: 1,
      });
      // Both endpoints' display forms ride along, so the link editor renders a
      // table without one follow-up read per row.
      expect(body.specialtyCode).toBeTruthy();
      expect(body.specialtyName).toBeTruthy();
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(
        `/v1/admin/direction-specialties/${body.id as string}`,
      );

      // The SAME row is what detail and the scoped list render.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-specialties/${body.id as string}`,
        headers: adminRead(),
      });
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as { id: string }).id).toBe(body.id);

      const list = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-specialties?directionId=${direction.id}`,
        headers: adminRead(),
      });
      expect(list.statusCode).toBe(200);
      const listBody = list.json() as { data: { id: string }[]; total: number };
      expect(listBody.data.map((r) => r.id)).toEqual([body.id]);
      expect(listBody.total).toBe(1);
    });

    it("EARS-8.2: refuses a second row for a pair that already exists, active or retired", async () => {
      const direction = await makeDirection("Неврология");
      const first = await linked(direction.id, specialtyA);

      const duplicate = await link(direction.id, specialtyA);
      expect(duplicate.statusCode).toBe(409);

      // Retiring it does NOT free the pair: the retained row is restored, never
      // duplicated, so the audit lineage of the link stays single.
      const retire = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-specialties/${first.id}/retire`,
        headers: { ...adminWrite(), "if-match": 'W/"1"' },
        payload: {},
      });
      expect(retire.statusCode).toBe(200);

      const afterRetire = await link(direction.id, specialtyA);
      expect(afterRetire.statusCode).toBe(409);
      expect(afterRetire.json() as { detail?: string }).toMatchObject({
        detail: expect.stringContaining("restore"),
      });
    });

    it("EARS-8.3: retire and restore move the SAME link row and bump its version", async () => {
      const direction = await makeDirection("Онкология");
      const created = await linked(direction.id, specialtyA);

      const retire = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-specialties/${created.id}/retire`,
        headers: { ...adminWrite(), "if-match": 'W/"1"' },
        payload: {},
      });
      expect(retire.statusCode).toBe(200);
      expect(retire.json()).toMatchObject({
        id: created.id,
        status: "retired",
        version: 2,
      });
      expect(retire.headers.etag).toBe('W/"2"');

      // Retired links leave the default list and come back only when asked for.
      const defaultList = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-specialties?directionId=${direction.id}`,
        headers: adminRead(),
      });
      expect((defaultList.json() as { total: number }).total).toBe(0);
      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-specialties?directionId=${direction.id}&includeRetired=true`,
        headers: adminRead(),
      });
      expect((withRetired.json() as { total: number }).total).toBe(1);

      const restore = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-specialties/${created.id}/restore`,
        headers: { ...adminWrite(), "if-match": 'W/"2"' },
        payload: {},
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json()).toMatchObject({
        id: created.id,
        status: "active",
        version: 3,
      });

      // Exactly ONE row ever existed for this pair.
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM direction_specialties WHERE direction_id = $1 AND specialty_minzdrav_id = $2",
        [direction.id, specialtyA],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("EARS-8.4: a lifecycle transition without a usable If-Match is refused before anything moves", async () => {
      const direction = await makeDirection("Эндокринология");
      const created = await linked(direction.id, specialtyA);

      const noIfMatch = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-specialties/${created.id}/retire`,
        headers: adminWrite(),
        payload: {},
      });
      expect(noIfMatch.statusCode).toBe(428);

      const staleIfMatch = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-specialties/${created.id}/retire`,
        headers: { ...adminWrite(), "if-match": 'W/"7"' },
        payload: {},
      });
      expect(staleIfMatch.statusCode).toBe(412);

      // Zero side effects: the row is still exactly as it was created.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-specialties/${created.id}`,
        headers: adminRead(),
      });
      expect(detail.json()).toMatchObject({ status: "active", version: 1 });
    });

    it("EARS-8.5: an unknown direction or an unknown specialty is refused, and a non-admin session never reaches the surface", async () => {
      const direction = await makeDirection("Пульмонология");

      const unknownDirection = await link(randomUUID(), specialtyA);
      expect(unknownDirection.statusCode).toBe(404);
      // The Минздрав book is CLOSED (#1479): an unknown specialty id is a 404,
      // never an implicit insert into the reference book.
      const unknownSpecialty = await link(direction.id, randomUUID());
      expect(unknownSpecialty.statusCode).toBe(404);

      const cookie = await doctorCookie();
      const asDoctor = await app.inject({
        method: "GET",
        url: "/v1/admin/direction-specialties",
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
      });
      // A DOCTOR-portal session is not an admin session (011 EARS-2).
      expect(asDoctor.statusCode).toBe(401);
      const anonymous = await app.inject({
        method: "GET",
        url: "/v1/admin/direction-specialties",
        headers: device,
      });
      expect(anonymous.statusCode).toBe(401);
    });

    // ── direction adjacency ────────────────────────────────────────────────

    it("EARS-8.6: authors a DIRECTED adjacency edge and treats the reverse pair as a separate edge", async () => {
      const a = await makeDirection("Кардиология");
      const b = await makeDirection("Терапия");

      const forward = await edged({
        directionId: a.id,
        adjacentDirectionId: b.id,
        kind: "related",
        weight: 60,
      });

      const duplicate = await edge({
        directionId: a.id,
        adjacentDirectionId: b.id,
        kind: "related",
        weight: 10,
      });
      expect(duplicate.statusCode).toBe(409);

      // The reverse edge is a DIFFERENT statement with its own kind and weight —
      // adjacency is not symmetric, and nothing is written that no operator
      // authored.
      const reverse = await edged({
        directionId: b.id,
        adjacentDirectionId: a.id,
        kind: "subdiscipline",
        weight: 20,
      });
      expect(reverse.id).not.toBe(forward.id);

      const fromA = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-adjacency?directionId=${a.id}`,
        headers: adminRead(),
      });
      expect(
        (fromA.json() as { data: { id: string }[] }).data.map((r) => r.id),
      ).toEqual([forward.id]);
      // The reverse question a directed edge makes askable.
      const towardsA = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-adjacency?adjacentDirectionId=${a.id}`,
        headers: adminRead(),
      });
      expect(
        (towardsA.json() as { data: { id: string }[] }).data.map((r) => r.id),
      ).toEqual([reverse.id]);
    });

    it("EARS-8.7: refuses a self-edge, an out-of-range weight and a kind outside the closed vocabulary", async () => {
      const a = await makeDirection("Гематология");
      const b = await makeDirection("Иммунология");

      const selfEdge = await edge({
        directionId: a.id,
        adjacentDirectionId: a.id,
        kind: "related",
        weight: 10,
      });
      expect(selfEdge.statusCode).toBe(400);

      for (const weight of [0, 101]) {
        const res = await edge({
          directionId: a.id,
          adjacentDirectionId: b.id,
          kind: "related",
          weight,
        });
        expect(res.statusCode).toBe(400);
      }
      // `sibling` / `broader` were the free-text labels this surface used to
      // accept; under the closed vocabulary they are as invalid as a typo.
      for (const kind of [
        "Related",
        "sibling",
        "broader",
        "смежное",
        "two words",
        "",
      ]) {
        const res = await edge({
          directionId: a.id,
          adjacentDirectionId: b.id,
          kind,
          weight: 10,
        });
        expect(res.statusCode).toBe(400);
      }

      // Every refusal was pre-domain: no edge exists for the pair.
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM direction_adjacency WHERE direction_id = $1",
        [a.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("EARS-8.8: re-labels and re-weights the SAME edge under If-Match, and refuses editing a retired one", async () => {
      const a = await makeDirection("Ревматология");
      const b = await makeDirection("Ортопедия");
      const created = await edged({
        directionId: a.id,
        adjacentDirectionId: b.id,
        kind: "related",
        weight: 30,
      });

      const patched = await app.inject({
        method: "PATCH",
        url: `/v1/admin/direction-adjacency/${created.id}`,
        headers: { ...adminWrite(), "if-match": 'W/"1"' },
        payload: { kind: "subdiscipline", weight: 90 },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({
        id: created.id,
        kind: "subdiscipline",
        weight: 90,
        version: 2,
      });
      expect(patched.headers.etag).toBe('W/"2"');

      // The endpoints are the edge's identity and are not patchable: moving an
      // edge is retiring one and authoring another.
      const movedEndpoint = await app.inject({
        method: "PATCH",
        url: `/v1/admin/direction-adjacency/${created.id}`,
        headers: { ...adminWrite(), "if-match": 'W/"2"' },
        payload: { adjacentDirectionId: a.id },
      });
      expect(movedEndpoint.statusCode).toBe(400);

      const retire = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-adjacency/${created.id}/retire`,
        headers: { ...adminWrite(), "if-match": 'W/"2"' },
        payload: {},
      });
      expect(retire.statusCode).toBe(200);
      const editRetired = await app.inject({
        method: "PATCH",
        url: `/v1/admin/direction-adjacency/${created.id}`,
        headers: { ...adminWrite(), "if-match": 'W/"3"' },
        payload: { weight: 5 },
      });
      // Re-labelling something out of effect would tell the operator they
      // changed what the targeting resolution reads. They did not.
      expect(editRetired.statusCode).toBe(409);
    });

    // ── 017 EARS-18: «Вид связи» is a closed list, «Вес» is not authored ───

    it("EARS-18.1: accepts every member of the closed «Вид связи» vocabulary and stores it verbatim", async () => {
      const own = await makeDirection("Кардиология");
      for (const kind of DIRECTION_ADJACENCY_KINDS) {
        const adjacent = await makeDirection("Детская кардиология");
        const created = await edged({
          directionId: own.id,
          adjacentDirectionId: adjacent.id,
          kind,
        });
        // The wire value is the machine slug; the RU label an operator reads
        // («Смежное направление» …) is the admin's presentation, never storage.
        const { rows } = await pool.query<{ kind: string }>(
          "SELECT kind::text AS kind FROM direction_adjacency WHERE id = $1",
          [created.id],
        );
        expect(rows[0]!.kind).toBe(kind);
      }
    });

    it("EARS-18.2: refuses a kind outside the vocabulary with a 400 naming the field, never a 500 from the type cast", async () => {
      const own = await makeDirection("Гастроэнтерология");
      const adjacent = await makeDirection("Гепатология");
      const res = await edge({
        directionId: own.id,
        adjacentDirectionId: adjacent.id,
        kind: "smezhnoe",
      });
      expect(res.statusCode).toBe(400);
      const problem = res.json() as {
        errors?: { path: string }[];
      };
      expect(problem.errors?.map((e) => e.path)).toContain("kind");
      // A pre-domain refusal writes nothing.
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM direction_adjacency WHERE direction_id = $1",
        [own.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("EARS-18.3: an edge authored without «Вес» takes the column default instead of demanding a number from the operator", async () => {
      const own = await makeDirection("Пульмонология");
      const adjacent = await makeDirection("Аллергология");
      const created = await edged({
        directionId: own.id,
        adjacentDirectionId: adjacent.id,
        kind: "interdisciplinary",
      });
      // Weight is a tuning parameter of targeting resolution, so the operator
      // interface never asks for it — but the row is still fully specified.
      const { rows } = await pool.query<{ weight: number }>(
        "SELECT weight FROM direction_adjacency WHERE id = $1",
        [created.id],
      );
      expect(rows[0]!.weight).toBe(DIRECTION_ADJACENCY_WEIGHT_DEFAULT);

      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-adjacency?directionId=${own.id}`,
        headers: adminRead(),
      });
      expect(
        (detail.json() as { data: { weight: number }[] }).data[0]!.weight,
      ).toBe(DIRECTION_ADJACENCY_WEIGHT_DEFAULT);
    });

    // ── The AC: a TargetingSet resolved from managed rows only ─────────────

    it("EARS-8.9: resolves a TargetingSet-shaped traversal — specialty → own directions → adjacent directions with kind and weight — purely from rows authored through the admin API", async () => {
      // Everything below is AUTHORED, never seeded: three directions, two
      // specialty links, three adjacency edges and one retired edge.
      const own = await makeDirection("Кардиология");
      const near = await makeDirection("Терапия");
      const far = await makeDirection("Неврология");
      const unrelated = await makeDirection("Дерматология");

      await linked(own.id, specialtyA);
      // A second link on a DIFFERENT specialty must not leak into the answer.
      await linked(unrelated.id, specialtyB);

      const strong = await edged({
        directionId: own.id,
        adjacentDirectionId: near.id,
        kind: "related",
        weight: 80,
      });
      const weak = await edged({
        directionId: own.id,
        adjacentDirectionId: far.id,
        kind: "subdiscipline",
        weight: 20,
      });
      // A retired edge is authored and withdrawn: it must NOT be reachable.
      const withdrawn = await edged({
        directionId: own.id,
        adjacentDirectionId: unrelated.id,
        kind: "related",
        weight: 99,
      });
      const retire = await app.inject({
        method: "POST",
        url: `/v1/admin/direction-adjacency/${withdrawn.id}/retire`,
        headers: { ...adminWrite(), "if-match": 'W/"1"' },
        payload: {},
      });
      expect(retire.statusCode).toBe(200);

      // Step 1 — the chosen specialty's own directions.
      const links = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-specialties?specialtyMinzdravId=${specialtyA}`,
        headers: adminRead(),
      });
      expect(links.statusCode).toBe(200);
      const ownDirectionIds = (
        links.json() as { data: { directionId: string }[] }
      ).data.map((r) => r.directionId);
      expect(ownDirectionIds).toContain(own.id);
      expect(ownDirectionIds).not.toContain(unrelated.id);

      // Step 2 — the adjacent directions of each own direction, each carrying
      // the authored kind and weight that order the targeted block.
      const adjacency = await app.inject({
        method: "GET",
        url: `/v1/admin/direction-adjacency?directionId=${own.id}`,
        headers: adminRead(),
      });
      expect(adjacency.statusCode).toBe(200);
      const edges = (
        adjacency.json() as {
          data: {
            id: string;
            adjacentDirectionId: string;
            adjacentDirectionTitle: string;
            kind: string;
            weight: number;
          }[];
        }
      ).data;

      // Exactly the two edges still in effect, heaviest first — the order a
      // targeted block with fewer slots than candidates truncates by.
      expect(edges.map((e) => e.id)).toEqual([strong.id, weak.id]);
      expect(edges.map((e) => e.adjacentDirectionId)).toEqual([
        near.id,
        far.id,
      ]);
      expect(edges.map((e) => e.weight)).toEqual([80, 20]);
      expect(edges.map((e) => e.kind)).toEqual(["related", "subdiscipline"]);
      // The withdrawn edge is out of the set, and its target with it.
      expect(edges.map((e) => e.adjacentDirectionId)).not.toContain(
        unrelated.id,
      );
      // Every adjacent entry is labellable as ADJACENT because a managed row
      // says so — the titles come from the same read, so the resolver needs no
      // follow-up query per candidate.
      expect(edges.map((e) => e.adjacentDirectionTitle)).toEqual([
        near.title,
        far.title,
      ]);
    });
  },
);
