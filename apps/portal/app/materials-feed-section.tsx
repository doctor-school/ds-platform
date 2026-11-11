"use client";

import { FeedRail } from "@ds/design-system/blocks";

import { loadFeedPage } from "./materials-feed-loader";

/**
 * 048 EARS-14 — the Academy home feed section. The rail reads its first page
 * in the browser (048 EARS-16, design «Home read»); `id="feed-h"` is the way
 * back of the reading page (canvas `academy-home#feed-h`).
 */
export function MaterialsFeedSection() {
  return (
    <div
      id="feed-h"
      data-academy-section="feed"
      className="scroll-mt-24 pt-16 layout:pt-24"
    >
      <FeedRail loadPage={loadFeedPage} />
    </div>
  );
}
