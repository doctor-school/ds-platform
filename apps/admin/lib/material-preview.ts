import type { MaterialArticleContent } from "@ds/design-system/material-article";
import type { MaterialBody, MaterialKind } from "@ds/schemas";

/**
 * 048 EARS-3 (#3514) — the admin preview's projection of the material form
 * state onto the `MaterialArticle` content: the shape the public material read
 * (EARS-11) gives the Academy page, so the preview IS the reading page of
 * EARS-12. The author follows the kind as on the public read — a news item's
 * trimmed author line, a column's chosen expert —, the partner is the chosen
 * organisation's name, the cover is the picked file (an object URL) or the
 * stored one, and the date is the first publication, absent until then.
 */
export interface MaterialPreviewInput {
  kind: MaterialKind;
  title: string;
  authorLine: string;
  expertName: string | null;
  partnerName: string | null;
  coverUrl: string | null;
  firstPublishedAt: string | null;
  body: MaterialBody;
}

export function materialPreviewContent(
  input: MaterialPreviewInput,
): MaterialArticleContent {
  const authorName =
    input.kind === "column" ? input.expertName : input.authorLine.trim();
  return {
    kind: input.kind,
    title: input.title.trim(),
    publishedAt: input.firstPublishedAt,
    author: authorName ? { name: authorName } : null,
    partner: input.partnerName ? { name: input.partnerName } : null,
    cover: input.coverUrl ? { url: input.coverUrl } : null,
    body: input.body,
  };
}
