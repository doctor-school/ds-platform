import { describe, expect, it } from "vitest";
import { FakeObjectStorage } from "../storage/storage.fake.js";
import type { PublicFeedRow } from "./feed-entries.repository.js";
import { toFeedCard } from "./public-reads.service.js";

// 048 EARS-10 (#3513) — a card's image: an own card stores the 012 media key
// (`image_ref`), signed fresh at every read; a network card stores the
// absolute URL of its source platform (`image_url`), passed through as is.

const row = (image: Pick<PublicFeedRow, "imageRef" | "imageUrl">) =>
  ({
    id: crypto.randomUUID(),
    kind: "news",
    title: "Материал",
    sourcePlatform: "academy",
    sourceName: "Академия",
    href: "/materials/m",
    publishedAt: new Date("2026-10-30T10:00:00.000Z"),
    publishedAtCursor: "2026-10-30T10:00:00.000000Z",
    expertFamilyName: null,
    expertGivenName: null,
    expertPatronymic: null,
    partnerTitle: null,
    ...image,
  }) as PublicFeedRow;

describe("048 feed card image (EARS-10)", () => {
  const storage = new FakeObjectStorage();

  it("048 EARS-10: an image_ref card's URL is the key signed by object storage at the read", async () => {
    const card = await toFeedCard(
      row({ imageRef: "materials/covers/a.webp", imageUrl: null }),
      storage,
    );
    expect(card.image).toEqual({
      url: await storage.urlFor("materials/covers/a.webp"),
    });
  });

  it("048 EARS-10: an image_url card's absolute URL passes through unchanged", async () => {
    const card = await toFeedCard(
      row({ imageRef: null, imageUrl: "https://network.example/c.webp" }),
      storage,
    );
    expect(card.image).toEqual({ url: "https://network.example/c.webp" });
  });

  it("048 EARS-10: a card with neither has no image", async () => {
    const card = await toFeedCard(
      row({ imageRef: null, imageUrl: null }),
      storage,
    );
    expect(card.image).toBeNull();
  });
});
