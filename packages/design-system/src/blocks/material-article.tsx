import * as React from "react";
import type { MaterialBody, MaterialKind } from "@ds/schemas";

import { cn } from "../lib/utils";
import { Alert } from "../primitives/alert";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { Link } from "../primitives/link";
import { Skeleton } from "../primitives/skeleton";
import { RichTextContent } from "./rich-text-content";

/**
 * `MaterialArticle` (048 EARS-12, EARS-3; #3514) — the ONE reading-page body of
 * a material, mounted by the Academy route `/materials/{slug}` and by the admin
 * preview `Sheet` (which renders it from the unsaved form state with the
 * preview banner). Built from the vendored canvas
 * `design-source/academy-material.dc.html` (Stage A approved by the owner on
 * 2026-11-04, #3514): the back link «← Новости, блог и видео», the kind label
 * (`Badge variant="label"`), the title, the byline «<author> · <day>», the
 * partner mark «Партнёрский материал · <name>» under the byline only when the
 * read carries a partner (EARS-19), the 16:9 cover only when there is one, and
 * the body through `RichTextContent` (no raw HTML; the link target rule lives
 * there). The canvas `state` switch maps onto `state`: обычное → `content`,
 * загрузка → `loading` (the skeleton column), ошибка → `error` (a danger
 * `Alert` with «Повторить»). The not-found state is not drawn: an unknown or
 * unpublished address renders the host's not-found page (048-design.md
 * §«Academy — reading page»).
 *
 * The preview banner is approved-non-canvas (lead decision 2026-10-29, #3514):
 * an info `Alert` above the article.
 *
 * Typography maps the canvas onto DS tokens (no arbitrary values): the frame
 * max 1104px → `max-w-content`, the column 720px → `max-w-180`; the side
 * padding clamp(16px,4vw,48px) is the `gutter` token itself. Every other canvas
 * clamp becomes a two-token step taken at the DS breakpoint nearest the width
 * where the clamp crosses the midpoint of the two tokens, so 640–1100px follows
 * the canvas: top padding clamp(28–48px, 4.5vw) → `pt-7` → `md:pt-12`; bottom
 * clamp(52–96px, 8vw) → `pb-13` → `lg:pb-24`; back-link gap clamp(24–36px,
 * 3.5vw) → `mb-6` → `md:mb-9`; header and cover gaps clamp(28–40px, 4vw) →
 * `mb-7` → `md:mb-10`; h1 clamp(28–42px, 3.6vw) / 800 / -.03em → `text-2xl` →
 * `lg:text-3xl`, `font-extrabold`, `tracking-tight`; byline 13.5px / 600 → `text-sm font-semibold`; partner mark
 * 12px / 17px → `text-xs`.
 */

export const MATERIAL_ARTICLE_COPY = {
  back: "← Новости, блог и видео",
  kinds: { news: "Новость", column: "Колонка эксперта" },
  partnerPrefix: "Партнёрский материал · ",
  loading: "Загружаем материал…",
  errorTitle: "Не удалось загрузить материал.",
  retry: "Повторить",
  previewBanner: "Предпросмотр — материал не опубликован",
} as const;

/** What the article shows: the public material read, or the preview's form state. */
export interface MaterialArticleContent {
  kind: MaterialKind;
  title: string;
  /** ISO instant of the first publication; `null` in an unsaved preview. */
  publishedAt: string | null;
  author: { name: string } | null;
  partner: { name: string } | null;
  cover: { url: string } | null;
  body: MaterialBody;
}

interface MaterialArticleBase extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** The way back to the Academy home news block; omitted in the preview. */
  backHref?: string;
}

export type MaterialArticleProps = MaterialArticleBase &
  (
    | {
        state?: "content";
        material: MaterialArticleContent;
        /** The preview banner text (EARS-3); absent on the public page. */
        banner?: string;
      }
    | { state: "loading" }
    | { state: "error"; onRetry: () => void; retrying?: boolean }
  );

const MSK_DAY = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
});

/** The publication day as the canvas byline spells it: «19 августа», in МСК. */
export function formatMaterialPublishedDay(isoInstant: string): string {
  return MSK_DAY.format(new Date(isoInstant));
}

const SKELETON_LINES = [
  "h-3.5 w-full",
  "h-3.5 w-11/12",
  "h-3.5 w-5/6",
  "mb-2.5 h-3.5 w-3/5",
  "h-3.5 w-full",
  "h-3.5 w-11/12",
  "h-3.5 w-2/3",
];

function Header({ material }: { material: MaterialArticleContent }) {
  const byline = [
    material.author?.name,
    material.publishedAt
      ? formatMaterialPublishedDay(material.publishedAt)
      : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return (
    <header className="mb-7 flex flex-col gap-4 md:mb-10">
      <div className="flex">
        <Badge variant="label">
          {MATERIAL_ARTICLE_COPY.kinds[material.kind]}
        </Badge>
      </div>
      <h1 className="m-0 text-2xl leading-title font-extrabold tracking-tight text-balance text-foreground lg:text-3xl">
        {material.title}
      </h1>
      {byline || material.partner ? (
        <div className="flex flex-col gap-2">
          {byline ? (
            <div
              data-testid="material-byline"
              className="text-sm font-semibold text-muted-foreground tabular-nums"
            >
              {byline}
            </div>
          ) : null}
          {material.partner ? (
            <div
              data-testid="material-partner-mark"
              className="text-xs font-semibold text-muted-foreground"
            >
              {MATERIAL_ARTICLE_COPY.partnerPrefix}
              {material.partner.name}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

const MaterialArticle = React.forwardRef<HTMLDivElement, MaterialArticleProps>(
  (props, ref) => {
    const { backHref, className, ...rest } = props;
    const domProps = { ...rest } as Record<string, unknown>;
    for (const key of ["state", "material", "banner", "onRetry", "retrying"])
      delete domProps[key];

    let inner: React.ReactNode;
    if (props.state === "loading") {
      inner = (
        <div role="status" aria-busy="true" className="flex flex-col gap-3.5">
          <span className="sr-only">{MATERIAL_ARTICLE_COPY.loading}</span>
          <Skeleton className="h-5.5 w-30" />
          <Skeleton className="h-8.5 w-11/12" />
          <Skeleton className="h-8.5 w-2/3" />
          <Skeleton className="mb-3 h-3.5 w-55" />
          {SKELETON_LINES.map((line, index) => (
            <Skeleton key={index} className={line} />
          ))}
        </div>
      );
    } else if (props.state === "error") {
      const { onRetry, retrying } = props;
      inner = (
        <Alert variant="danger" data-testid="material-error">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="font-bold">
              {MATERIAL_ARTICLE_COPY.errorTitle}
            </span>
            <Button
              variant="secondary"
              aria-busy={retrying || undefined}
              aria-disabled={retrying || undefined}
              onClick={retrying ? undefined : onRetry}
            >
              {MATERIAL_ARTICLE_COPY.retry}
            </Button>
          </div>
        </Alert>
      );
    } else {
      const { material, banner } = props;
      inner = (
        <>
          {banner ? (
            <Alert
              variant="info"
              data-testid="material-preview-banner"
              className="mb-7"
            >
              <span className="font-bold">{banner}</span>
            </Alert>
          ) : null}
          <article>
            <Header material={material} />
            {material.cover ? (
              <figure
                data-testid="material-cover"
                className="relative m-0 mb-7 aspect-video overflow-hidden border-2 border-border bg-section md:mb-10"
              >
                <img
                  src={material.cover.url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </figure>
            ) : null}
            <RichTextContent body={material.body} />
          </article>
        </>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "mx-auto box-border w-full max-w-content px-gutter pt-7 pb-13 md:pt-12 lg:pb-24",
          className,
        )}
        {...domProps}
      >
        <div className="max-w-180 min-w-0">
          {backHref ? (
            <div className="mb-6 md:mb-9">
              <Link href={backHref} size="sm" weight="strong">
                {MATERIAL_ARTICLE_COPY.back}
              </Link>
            </div>
          ) : null}
          {inner}
        </div>
      </div>
    );
  },
);
MaterialArticle.displayName = "MaterialArticle";

export { MaterialArticle };
