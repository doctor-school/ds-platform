import type { FeedValueContent } from "@ds/schemas";

/**
 * 018 EARS-7 — the editorial copy of «Зачем это мне», one constant for every
 * specialty (018-design §1: carried by the envelope, no read of its own). The
 * item strings are the owner-approved canvas `design-source/doctor-feed.dc.html`
 * value section. The canvas closing strip is not built (LD-9): the block makes
 * no statement about money or who pays.
 */
export const SPECIALTY_FEED_VALUE_COPY: FeedValueContent = {
  items: [
    {
      title: "Новая специальность",
      body: "Школа ведёт в новый трек — например, ортобиологию.",
    },
    {
      title: "Международная стажировка",
      body: "Лучшие участники школ едут на клинические базы.",
    },
    {
      title: "Наставничество у эксперта",
      body: "Разбор ваших случаев с автором школы.",
    },
    {
      title: "Документ по итогам курса",
      body: "Сертификат — за полное прохождение курса.",
    },
  ],
};
