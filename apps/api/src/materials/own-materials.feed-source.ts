import { Inject, Injectable } from "@nestjs/common";
import type { Material } from "@ds/db";
import { FeedEntriesRepository } from "./feed-entries.repository.js";
import type { MaterialsTx } from "./materials.repository.js";

// 048 EARS-4…EARS-6, EARS-10 (#3512) — the own-materials feed source: the
// Academy's own materials as cards of the feed. Called by the materials
// service inside the transaction of a publish, an edit of a published
// material, or an unpublish, so the card and its material never disagree.
//
// The card is denormalized on purpose (048-design §Data model): title, image,
// source name and href are written here; what 012 and 032 own — the expert's
// name and status, the organisation's title, status and name rule — is only
// referenced by id and judged at the read.

/** The source name of an Academy news card (EARS-9). */
export const ACADEMY_SOURCE_NAME = "Академия";

@Injectable()
export class OwnMaterialsFeedSource {
  constructor(
    @Inject(FeedEntriesRepository)
    private readonly entries: FeedEntriesRepository,
  ) {}

  /** Write (or rewrite) the card of a published material. */
  async write(
    tx: MaterialsTx,
    material: Material,
    coverUrl: string | null,
  ): Promise<void> {
    if (material.status !== "published" || !material.firstPublishedAt) {
      throw new Error("only a published material has a feed entry");
    }
    await this.entries.upsert(tx, {
      sourcePlatform: "academy",
      sourceRef: material.id,
      materialId: material.id,
      kind: material.kind,
      title: material.title,
      imageUrl: coverUrl,
      sourceName: material.kind === "news" ? ACADEMY_SOURCE_NAME : null,
      authorExpertId: material.kind === "column" ? material.expertId : null,
      partnerOrganisationId: material.partnerOrganisationId,
      href: `/materials/${material.slug}`,
      publishedAt: material.firstPublishedAt,
    });
  }

  /** Remove the card of a material that leaves the site (EARS-6). */
  async remove(tx: MaterialsTx, material: Material): Promise<void> {
    await this.entries.remove(tx, "academy", material.id);
  }
}
