import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { PublicFeedPageSchema, PublicMaterialSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/storage/index.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-4 (#3513) — the two anonymous reads over the REAL stack (Fastify +
// Postgres): the feed page (EARS-9, EARS-10, EARS-19) and the material read
// (EARS-11, EARS-19). Rows are seeded directly — the authoring path is the
// #3512 suite's subject — inside a far-future instant window unique to this
// run, and every page walk starts from a cursor just above that window, so
// rows other suites write concurrently can never interleave with ours.
describe.skipIf(!process.env.DATABASE_URL)(
  "048 materials public reads (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let storage: ObjectStorage;
    const materialIds: string[] = [];
    const expertIds: string[] = [];
    const organisationIds: string[] = [];
    // A unique minute in the 29th century — no real feed entry lives there.
    const windowBase =
      Date.UTC(2900, 0, 1) + Math.floor(Math.random() * 5e6) * 60_000;
    const marker = () => randomUUID().slice(0, 8);
    const doc = (s: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: s }] }],
    });

    /** An instant `seconds` into the window, with microseconds Postgres keeps and a Date drops. */
    function at(seconds: number, micros = 123_456): string {
      const iso = new Date(windowBase + seconds * 1000).toISOString();
      return `${iso.slice(0, 19)}.${String(micros).padStart(6, "0")}Z`;
    }

    /** The cursor of a position just above every row of the window. */
    function windowTop(): string {
      return Buffer.from(
        JSON.stringify({ publishedAt: at(10_000), id: randomUUID() }),
      ).toString("base64url");
    }

    async function expert(status: "draft" | "published"): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (slug, family_name, given_name, patronymic, status, first_published_at)
         VALUES ($1, 'Страхов', 'Михаил', 'Андреевич', $2::taxonomy_status,
                 CASE WHEN $2::text = 'draft' THEN NULL ELSE now() END)
         RETURNING id`,
        [`pub-expert-${marker()}`, status],
      );
      expertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function organisation(
      status: "draft" | "published",
      nameVisible = true,
    ): Promise<{ id: string; title: string }> {
      const title = `Партнёр ${marker()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO organisations (slug, title, status, first_published_at, public_name_visible)
         VALUES ($1, $2, $3::taxonomy_status,
                 CASE WHEN $3::text = 'draft' THEN NULL ELSE now() END, $4)
         RETURNING id`,
        [`pub-org-${marker()}`, title, status, nameVisible],
      );
      organisationIds.push(rows[0]!.id);
      return { id: rows[0]!.id, title };
    }

    interface Seed {
      kind?: "news" | "column";
      status?: "draft" | "published";
      expertId?: string | null;
      partnerId?: string | null;
      publishedAt?: string;
      authorLine?: string;
      coverRef?: string | null;
      withEntry?: boolean;
    }

    /** A material and, when published, its feed entry as the own-materials source writes it. */
    async function material(seed: Seed = {}): Promise<{
      id: string;
      slug: string;
      entryId: string | null;
    }> {
      const kind = seed.kind ?? "news";
      const status = seed.status ?? "published";
      const slug = `pub-mat-${marker()}`;
      const publishedAt = seed.publishedAt ?? at(0);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO materials (slug, kind, title, author_line, expert_id, partner_organisation_id,
                                cover_ref, body, status, first_published_at)
         VALUES ($1, $2::material_kind, $3, $4, $5, $6, $7, $8::jsonb, $9::material_status,
                 CASE WHEN $9::text = 'published' THEN $10::timestamptz END)
         RETURNING id`,
        [
          slug,
          kind,
          `Материал ${slug}`,
          seed.authorLine ?? "",
          kind === "column" ? (seed.expertId ?? null) : null,
          seed.partnerId ?? null,
          seed.coverRef ?? null,
          JSON.stringify(doc(`Текст ${slug}`)),
          status,
          publishedAt,
        ],
      );
      const id = rows[0]!.id;
      materialIds.push(id);
      if (status !== "published" || seed.withEntry === false) {
        return { id, slug, entryId: null };
      }
      const entry = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries (source_platform, source_ref, material_id, kind, title, image_ref,
                                   source_name, author_expert_id, partner_organisation_id, href, published_at)
         VALUES ('academy', $1::text, $1::text::uuid, $2::feed_entry_kind, $3, $4, $5, $6, $7, $8, $9::timestamptz)
         RETURNING id`,
        [
          id,
          kind,
          `Материал ${slug}`,
          seed.coverRef ?? null,
          kind === "news" ? "Академия" : null,
          kind === "column" ? (seed.expertId ?? null) : null,
          seed.partnerId ?? null,
          `/materials/${slug}`,
          publishedAt,
        ],
      );
      return { id, slug, entryId: entry.rows[0]!.id };
    }

    async function feed(query = "") {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/feed${query}`,
      });
      return res;
    }

    /** Every card of our window, walking pages of `limit` from the window top. */
    async function walk(limit: number) {
      const cards: { id: string; publishedAt: string }[] = [];
      let cursor: string | null = windowTop();
      let pages = 0;
      while (cursor && pages < 50) {
        const res = await feed(`?limit=${limit}&cursor=${cursor}`);
        expect(res.statusCode, res.payload).toBe(200);
        const page = PublicFeedPageSchema.parse(res.json());
        const ours = page.data.filter(
          (c) => Date.parse(c.publishedAt) >= windowBase,
        );
        cards.push(...ours);
        pages += 1;
        cursor = ours.length === page.data.length ? page.nextCursor : null;
      }
      return cards;
    }

    async function card(entryId: string) {
      return (await walk(24)).find((c) => c.id === entryId) as
        Record<string, unknown> | undefined;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
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
      storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    });

    afterEach(async () => {
      for (const id of materialIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE material_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM materials WHERE id = $1", [id]);
      }
      for (const id of expertIds.splice(0)) {
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
      for (const id of organisationIds.splice(0)) {
        await pool.query("DELETE FROM organisations WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await app?.close();
    });

    // ── V-4: the feed read (EARS-9) ──────────────────────────────────────

    it("048 EARS-9: when any caller reads the feed, the system shall return cards of the common shape newest first with ties by id, and no body", async () => {
      const a = await material({ publishedAt: at(30) });
      const tieLow = await material({ publishedAt: at(20, 5) });
      const tieHigh = await material({ publishedAt: at(20, 5) });
      const oldest = await material({ publishedAt: at(10) });
      const cards = await walk(24);
      const tie = [tieLow.entryId!, tieHigh.entryId!].sort().reverse();
      expect(cards.map((c) => c.id)).toEqual([
        a.entryId,
        ...tie,
        oldest.entryId,
      ]);
      const first = cards[0] as Record<string, unknown>;
      expect(first).toEqual({
        id: a.entryId,
        kind: "news",
        title: `Материал ${a.slug}`,
        publishedAt: new Date(Date.parse(at(30))).toISOString(),
        image: null,
        source: { platform: "academy", name: "Академия" },
        partner: null,
        href: `/materials/${a.slug}`,
      });
      expect(first).not.toHaveProperty("body");

      const anonymous = await feed();
      expect(anonymous.statusCode).toBe(200);
      expect(PublicFeedPageSchema.safeParse(anonymous.json()).success).toBe(
        true,
      );
    });

    it("048 EARS-9: cursor pages carry the microsecond-exact position — no gaps or repeats across inserts, nextCursor null at the end", async () => {
      // Same millisecond, different microseconds: a millisecond cursor would repeat or skip.
      const seeded = [];
      for (let i = 0; i < 5; i += 1) {
        seeded.push(await material({ publishedAt: at(100, 100_000 + i) }));
      }
      const first = await feed(`?limit=2&cursor=${windowTop()}`);
      const page1 = PublicFeedPageSchema.parse(first.json());
      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      // An insert newer than the cursor position must not shift the next pages.
      const newer = await material({ publishedAt: at(200) });
      const rest: string[] = [];
      let cursor = page1.nextCursor;
      while (cursor) {
        const page = PublicFeedPageSchema.parse(
          (await feed(`?limit=2&cursor=${cursor}`)).json(),
        );
        const ours = page.data.filter(
          (c) => Date.parse(c.publishedAt) >= windowBase,
        );
        rest.push(...ours.map((c) => c.id));
        cursor = ours.length === page.data.length ? page.nextCursor : null;
      }
      const walked = [...page1.data.map((c) => c.id), ...rest];
      const expected = seeded.map((s) => s.entryId!).reverse();
      expect(walked).toEqual(expected);
      expect(new Set(walked).size).toBe(walked.length);
      expect(walked).not.toContain(newer.entryId);

      // The last page of the window ends the walk: a cursor below every feed row.
      const bottom = Buffer.from(
        JSON.stringify({
          publishedAt: "0001-01-01T00:00:00.000000Z",
          id: randomUUID(),
        }),
      ).toString("base64url");
      const end = PublicFeedPageSchema.parse(
        (await feed(`?cursor=${bottom}`)).json(),
      );
      expect(end).toEqual({ data: [], nextCursor: null });
    });

    it("048 EARS-9: the limit is 1–24 with default 12, and a malformed cursor is refused with 400", async () => {
      for (let i = 0; i < 13; i += 1) {
        await material({ publishedAt: at(300 + i) });
      }
      const byDefault = PublicFeedPageSchema.parse(
        (await feed(`?cursor=${windowTop()}`)).json(),
      );
      expect(byDefault.data).toHaveLength(12);
      expect(byDefault.nextCursor).not.toBeNull();
      const one = PublicFeedPageSchema.parse(
        (await feed(`?limit=1&cursor=${windowTop()}`)).json(),
      );
      expect(one.data).toHaveLength(1);
      expect((await feed("?limit=24")).statusCode).toBe(200);
      expect((await feed("?limit=25")).statusCode).toBe(400);
      expect((await feed("?limit=0")).statusCode).toBe(400);

      const truncated = Buffer.from(
        JSON.stringify({
          publishedAt: new Date(windowBase).toISOString(),
          id: randomUUID(),
        }),
      ).toString("base64url");
      for (const bad of [
        "not-base64-json",
        truncated,
        Buffer.from("{}").toString("base64url"),
      ]) {
        const res = await feed(`?cursor=${bad}`);
        expect(res.statusCode, bad).toBe(400);
        expect(res.json()).toMatchObject({ errorCode: "CURSOR_INVALID" });
      }
    });

    it("048 EARS-9: a column is absent while its expert is unpublished and back once published, its source the expert's current «Фамилия И. О.»", async () => {
      const expertId = await expert("draft");
      const column = await material({
        kind: "column",
        expertId,
        publishedAt: at(400),
      });
      expect(await card(column.entryId!)).toBeUndefined();

      await pool.query(
        "UPDATE experts SET status = 'published', first_published_at = now() WHERE id = $1",
        [expertId],
      );
      expect(await card(column.entryId!)).toMatchObject({
        kind: "column",
        source: { platform: "academy", name: "Страхов М. А." },
      });

      // The name is built at the read from the current 012 name parts.
      await pool.query(
        "UPDATE experts SET family_name = 'Иванова', given_name = 'Ольга', patronymic = NULL WHERE id = $1",
        [expertId],
      );
      expect(await card(column.entryId!)).toMatchObject({
        source: { name: "Иванова О." },
      });
    });

    // ── V-6: the feed-entry store (EARS-10) ──────────────────────────────

    it("048 EARS-10: the card renders from the feed entry alone — a card rewritten on the entry shows without reading the material", async () => {
      const news = await material({
        publishedAt: at(500),
        coverRef: "cover-a.webp",
      });
      // The material changes but its card is not rewritten: the read must keep the entry's card.
      await pool.query(
        "UPDATE materials SET title = 'Изменено в materials' WHERE id = $1",
        [news.id],
      );
      expect(await card(news.entryId!)).toMatchObject({
        title: `Материал ${news.slug}`,
        image: { url: await storage.urlFor("cover-a.webp") },
      });
    });

    it("048 EARS-10: an own card's image is the entry's media key signed at the read — never the stored key", async () => {
      const news = await material({
        publishedAt: at(510),
        coverRef: "materials/covers/card-key.webp",
      });
      const got = (await card(news.entryId!)) as
        { image: { url: string } | null } | undefined;
      const url = got?.image?.url;
      expect(url).toBe(await storage.urlFor("materials/covers/card-key.webp"));
      expect(url).not.toBe("materials/covers/card-key.webp");
    });

    // ── V-4: the partner (EARS-19) ───────────────────────────────────────

    it("048 EARS-19: partner is set only while its organisation is published with the name rule on, and never hides a material", async () => {
      const shown = await organisation("published");
      const hidden = await organisation("published", false);
      const draft = await organisation("draft");
      const withShown = await material({
        partnerId: shown.id,
        publishedAt: at(600),
      });
      const withHidden = await material({
        partnerId: hidden.id,
        publishedAt: at(601),
      });
      const withDraft = await material({
        partnerId: draft.id,
        publishedAt: at(602),
      });

      expect(await card(withShown.entryId!)).toMatchObject({
        partner: { name: shown.title },
      });
      expect(await card(withHidden.entryId!)).toMatchObject({ partner: null });
      expect(await card(withDraft.entryId!)).toMatchObject({ partner: null });

      const read = async (slug: string) =>
        (
          await app.inject({
            method: "GET",
            url: `/v1/public/materials/${slug}`,
          })
        ).json();
      expect(await read(withShown.slug)).toMatchObject({
        partner: { name: shown.title },
      });
      expect(await read(withHidden.slug)).toMatchObject({ partner: null });
      expect(await read(withDraft.slug)).toMatchObject({ partner: null });

      // The organisation's state is judged at the read.
      await pool.query(
        "UPDATE organisations SET public_name_visible = false WHERE id = $1",
        [shown.id],
      );
      expect(await card(withShown.entryId!)).toMatchObject({ partner: null });
      await pool.query(
        "UPDATE organisations SET public_name_visible = true WHERE id = $1",
        [hidden.id],
      );
      expect(await card(withHidden.entryId!)).toMatchObject({
        partner: { name: hidden.title },
      });
    });

    // ── V-4: the material read (EARS-11) ─────────────────────────────────

    it("048 EARS-11: when any caller reads a public material, the system shall answer its fields, the author as a plain name and its body", async () => {
      const news = await material({
        authorLine: "Редакция",
        coverRef: "cover-b.webp",
      });
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/materials/${news.slug}`,
      });
      expect(res.statusCode, res.payload).toBe(200);
      const body = PublicMaterialSchema.parse(res.json());
      expect(body).toEqual({
        slug: news.slug,
        kind: "news",
        title: `Материал ${news.slug}`,
        publishedAt: new Date(Date.parse(at(0))).toISOString(),
        cover: { url: await storage.urlFor("cover-b.webp") },
        author: { name: "Редакция" },
        partner: null,
        body: doc(`Текст ${news.slug}`),
      });

      const bare = await material({});
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/public/materials/${bare.slug}`,
          })
        ).json(),
      ).toMatchObject({ author: null, cover: null });

      const expertId = await expert("published");
      const column = await material({ kind: "column", expertId });
      const columnRead = await app.inject({
        method: "GET",
        url: `/v1/public/materials/${column.slug}`,
      });
      expect(columnRead.json()).toMatchObject({
        kind: "column",
        author: { name: "Страхов Михаил Андреевич" },
      });
      expect(JSON.stringify(columnRead.json())).not.toMatch(/pub-expert-/);
    });

    it("048 EARS-11: a draft, unknown or non-public material is answered 404 alike", async () => {
      const draft = await material({ status: "draft" });
      const expertId = await expert("draft");
      const hiddenColumn = await material({ kind: "column", expertId });
      const answers = [];
      for (const slug of [draft.slug, "pub-mat-unknown", hiddenColumn.slug]) {
        const res = await app.inject({
          method: "GET",
          url: `/v1/public/materials/${slug}`,
        });
        expect(res.statusCode, slug).toBe(404);
        const {
          instance: _instance,
          traceId: _traceId,
          ...problem
        } = res.json() as Record<string, unknown>;
        answers.push(problem);
      }
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    });
  },
);
