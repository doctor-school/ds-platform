import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  expertDisplayName,
  expertShortName,
  type FeedCard,
  type MaterialBody,
  type PublicFeedPage,
  type PublicFeedQuery,
  type PublicMaterial,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import { isEventCursorInstant, TaxonomyError } from "../taxonomy/index.js";
import {
  type FeedCursorPosition,
  FeedEntriesRepository,
  type PublicFeedRow,
} from "./feed-entries.repository.js";
import { MaterialsRepository } from "./materials.repository.js";

// 048 EARS-9, EARS-10, EARS-11, EARS-19 (#3513) — the two anonymous reads of
// the materials feed: a feed page and one public material. Everything 012 and
// 032 own (an expert's name and public state, an organisation's title and
// display rule) is judged by the repositories at the moment of the read.

/**
 * The feed cursor: `(published_at, id)` with the instant exactly as Postgres
 * rendered it to the microsecond — the `public-event-cursor.ts` rule, whose
 * grammar check this reuses, so a truncated or hand-mangled instant is a 400,
 * never a repeat or a 500. Opaque by contract (base64url JSON).
 */
const FEED_CURSOR_SHAPE = z
  .object({
    publishedAt: z
      .string()
      .refine(isEventCursorInstant, "not a cursor instant issued by this API"),
    id: z.uuid(),
  })
  .strict();

function encodeFeedCursor(row: PublicFeedRow): string {
  return Buffer.from(
    JSON.stringify({ publishedAt: row.publishedAtCursor, id: row.id }),
    "utf8",
  ).toString("base64url");
}

function decodeFeedCursor(cursor?: string): FeedCursorPosition | null {
  if (cursor === undefined) return null;
  try {
    const { publishedAt, id } = FEED_CURSOR_SHAPE.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { instant: publishedAt, id };
  } catch {
    throw new TaxonomyError(
      "CURSOR_INVALID",
      "this cursor was not issued by this API; start from the first page",
    );
  }
}

function toCard(row: PublicFeedRow): FeedCard {
  const name =
    row.sourceName ??
    expertShortName({
      familyName: row.expertFamilyName,
      givenName: row.expertGivenName,
      patronymic: row.expertPatronymic,
    });
  if (!name) {
    // The write side gives every entry either a source name or an author
    // expert, and the read keeps an expert entry only while the expert is
    // public — whose name parts are then required (012 CHECK).
    throw new Error(`feed entry ${row.id} has no source name`);
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    publishedAt: row.publishedAt.toISOString(),
    image: row.imageUrl ? { url: row.imageUrl } : null,
    source: { platform: row.sourcePlatform, name },
    partner: row.partnerTitle ? { name: row.partnerTitle } : null,
    href: row.href,
  };
}

@Injectable()
export class MaterialsPublicReadsService {
  constructor(
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
    @Inject(MaterialsRepository)
    private readonly materials: MaterialsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `GET /v1/public/feed` — EARS-9, EARS-10, EARS-19. */
  async feedPage(query: PublicFeedQuery): Promise<PublicFeedPage> {
    const before = decodeFeedCursor(query.cursor);
    const rows = await this.entries.publicPage(query.limit + 1, before);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toCard),
      nextCursor:
        rows.length > query.limit && last ? encodeFeedCursor(last) : null,
    };
  }

  /** `GET /v1/public/materials/{slug}` — EARS-11, EARS-19. */
  async material(slug: string): Promise<PublicMaterial> {
    const row = await this.materials.findPublicBySlug(slug);
    const publishedAt = row?.material.firstPublishedAt;
    if (!row || !publishedAt) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const { material } = row;
    const authorName =
      material.kind === "column"
        ? expertDisplayName({
            familyName: row.expertFamilyName,
            givenName: row.expertGivenName,
            patronymic: row.expertPatronymic,
          })
        : material.authorLine || null;
    return {
      slug: material.slug,
      kind: material.kind,
      title: material.title,
      publishedAt: publishedAt.toISOString(),
      cover: material.coverRef
        ? { url: await this.storage.urlFor(material.coverRef) }
        : null,
      author: authorName ? { name: authorName } : null,
      partner: row.partnerTitle ? { name: row.partnerTitle } : null,
      body: material.body as MaterialBody,
    };
  }
}
