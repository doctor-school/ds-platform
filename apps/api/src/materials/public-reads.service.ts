import { Inject, Injectable } from "@nestjs/common";
import {
  expertDisplayName,
  expertShortName,
  FEED_TELEGRAM_SOURCE_NAME,
  type FeedCard,
  type MaterialBody,
  type PublicFeedPage,
  type PublicFeedQuery,
  type PublicMaterial,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import { TaxonomyError } from "../taxonomy/index.js";
import { decodeFeedCursor, encodeFeedCursor } from "./feed-cursor.js";
import {
  FeedEntriesRepository,
  type PublicFeedRow,
} from "./feed-entries.repository.js";
import { MaterialsRepository } from "./materials.repository.js";

// 048 EARS-9, EARS-10, EARS-11, EARS-19 (#3513) — the two anonymous reads of
// the materials feed: a feed page and one public material. Everything 012 and
// 032 own (an expert's name and public state, an organisation's title and
// display rule) is judged by the repositories at the moment of the read.

/**
 * The card's image (EARS-10, EARS-33): an own card's cover and a Telegram
 * post's copied preview are stored as a media key (`image_ref`), signed fresh
 * at every read — a signed URL is short-lived, so it is never stored. A
 * Telegram preview not yet copied (`pending`) or given up (`failed`) has no
 * key, so the card takes its no-image layout. A network card that stores its
 * platform's absolute URL (`image_url`) has it passed through unchanged.
 */
async function feedCardImage(
  row: PublicFeedRow,
  storage: ObjectStorage,
): Promise<FeedCard["image"]> {
  if (row.imageRef) return { url: await storage.urlFor(row.imageRef) };
  return row.imageUrl ? { url: row.imageUrl } : null;
}

export async function toFeedCard(
  row: PublicFeedRow,
  storage: ObjectStorage,
): Promise<FeedCard> {
  if (row.sourcePlatform === "telegram" && row.kind === "post") {
    // EARS-33 — read from the stored entry alone: the read never calls
    // Telegram (EARS-35), and a Telegram card never carries a partner.
    return {
      id: row.id,
      kind: "post",
      text: row.title,
      publishedAt: row.publishedAt.toISOString(),
      image: await feedCardImage(row, storage),
      duration: row.durationSeconds,
      source: { platform: "telegram", name: FEED_TELEGRAM_SOURCE_NAME },
      partner: null,
      href: row.href,
      external: true,
    };
  }
  if (row.sourcePlatform !== "academy" || row.kind === "post") {
    // The read serves only `FEED_CARD_PLATFORMS` (048-design §Delivery
    // slices (slice 2)), and the connector writes a Telegram entry only as a
    // `post`; this is the last guard should the stored rows and the card
    // contract ever disagree.
    throw new Error(
      `feed entry ${row.id} is a ${row.sourcePlatform} ${row.kind} entry, which the card contract has no member for`,
    );
  }
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
    image: await feedCardImage(row, storage),
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

  /** `GET /v1/public/feed` — EARS-9, EARS-10, EARS-19, EARS-33, EARS-35. */
  async feedPage(query: PublicFeedQuery): Promise<PublicFeedPage> {
    const before = decodeFeedCursor(query.cursor);
    const rows = await this.entries.publicPage(query.limit + 1, before);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: await Promise.all(page.map((row) => toFeedCard(row, this.storage))),
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
