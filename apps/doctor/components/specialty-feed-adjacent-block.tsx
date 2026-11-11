import type { ReactNode } from "react";
import NextLink from "next/link";
import { headers } from "next/headers";
import { Link } from "@ds/design-system/link";
import { BlockError, BlockRetry } from "@ds/events-storefront/block";

import {
  fetchSpecialtyFeedAdjacent,
  type AdjacentAreasRead,
} from "@/lib/specialty-feed";

/**
 * Canvas labels (`design-source/doctor-feed.dc.html`, «d-feed · смежные
 * области») and the block's own states.
 */
const COPY = {
  kicker: "Не только ваша специальность",
  heading: "Смежные области",
  empty: "Для этой специальности смежные области пока не указаны.",
  errorTitle: "Не удалось загрузить смежные области",
  errorBody: "Сервер не ответил. Проверьте соединение и попробуйте снова.",
} as const;

/** The host's block retry: re-runs this block's read alone and answers its body. */
export type AdjacentBlockRetryAction = (
  specialtyCode: string,
) => Promise<ReactNode>;

/**
 * 018 EARS-8 (#1503) — «Смежные области», the last block of the specialty
 * feed. Each chip is an adjacent SPECIALTY the api reached over the managed
 * link and adjacency rows (`GET /v1/storefront/feed/{code}/adjacent`), and it
 * opens that specialty's own feed. Adjacent areas appear nowhere else in the
 * feed: the events block takes no adjacency widening (F-018-3).
 *
 * Not built from the canvas, on purpose: the chip counter («N уроков» — the
 * lessons type is not connected, LD-1) and the lead paragraph promising that
 * adjacent lessons and events enter this feed (untrue in release 1).
 *
 * The block's states mirror the nearest-events block beside it: no entries is
 * a statement in place of the chips; a failed read is the block's own error
 * and «Повторить», which re-runs this read alone (LD-7).
 */
export async function SpecialtyFeedAdjacentBlock({
  specialtyCode,
  retry,
}: {
  specialtyCode: string;
  retry: AdjacentBlockRetryAction;
}) {
  const requestHeaders = await headers();
  const read = await fetchSpecialtyFeedAdjacent(
    specialtyCode,
    requestHeaders.get("x-forwarded-for") ?? "",
  );
  return (
    <SpecialtyFeedAdjacentSection
      read={read}
      retry={retry}
      specialtyCode={specialtyCode}
    />
  );
}

export function SpecialtyFeedAdjacentSection({
  specialtyCode,
  read,
  retry,
}: {
  specialtyCode: string;
  read: AdjacentAreasRead;
  retry: AdjacentBlockRetryAction;
}) {
  return (
    <section
      aria-labelledby="specialty-feed-adjacent-heading"
      className="mt-12 px-4 layout:mt-20 layout:px-12"
      data-feed-kind="adjacent"
      data-screen-label="d-feed · смежные области"
      data-testid="specialty-feed-adjacent"
    >
      <div className="mx-auto w-full max-w-content">
        <p className="mb-2.5 text-xs font-extrabold uppercase tracking-widest text-primary-action">
          {COPY.kicker}
        </p>
        <h2
          id="specialty-feed-adjacent-heading"
          className="mb-5 text-2xl font-extrabold leading-none tracking-tight text-foreground layout:text-4xl"
        >
          {COPY.heading}
        </h2>
        <SpecialtyFeedAdjacentList
          read={read}
          retry={retry}
          specialtyCode={specialtyCode}
        />
      </div>
    </section>
  );
}

/** The block's body from its read — what its «Повторить» re-renders. */
export function SpecialtyFeedAdjacentList({
  specialtyCode,
  read,
  retry,
}: {
  specialtyCode: string;
  read: AdjacentAreasRead;
  retry: AdjacentBlockRetryAction;
}) {
  if (!read.ok) {
    return (
      <BlockRetry retry={retry.bind(null, specialtyCode)}>
        <BlockError
          title={COPY.errorTitle}
          description={COPY.errorBody}
          testId="specialty-feed-adjacent-error"
        />
      </BlockRetry>
    );
  }
  if (read.value.items.length === 0) {
    return (
      <p
        className="text-sm leading-relaxed text-muted-foreground"
        data-testid="specialty-feed-adjacent-empty"
      >
        {COPY.empty}
      </p>
    );
  }
  return (
    <ul
      className="flex flex-wrap gap-2.5"
      data-testid="specialty-feed-adjacent-items"
    >
      {read.value.items.map((item) => (
        <li key={item.specialty.id}>
          <Link asChild variant="chip" size="sm">
            <NextLink
              data-testid="specialty-feed-adjacent-item"
              href={item.feedHref}
            >
              {item.specialty.name}
            </NextLink>
          </Link>
        </li>
      ))}
    </ul>
  );
}
