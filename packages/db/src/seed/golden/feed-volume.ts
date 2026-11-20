// #4172 — the materials feed at volume (048).
//
// The named catalogue carries one news item and its card, so on a slot the
// Academy feed rail, the «Материалы» admin list and the network-source admin
// list render one row or none. This half writes what those read, as the
// product writes it:
//
//   * own materials — news and expert columns, a draft or two among them — and,
//     for every published one, the card `OwnMaterialsFeedSource.write` derives
//     (048 EARS-4): same title, the card date = the first publication instant;
//   * connected Telegram sources (048 slice 2) — working, unchecked and failing,
//     one switched off — and the text posts the webhook writes for them: a card
//     per post (`telegram.feed-source.ts`: `sourceRef = <source>:<message>`, the
//     permalink, no preview), an album as one card holding each part's message
//     id (EARS-27), the switched-off source's cards `source_off` (EARS-22).
//
// No cover and no post preview: both are media objects, and the cards render
// without one. Every instant is a whole-day offset from the dataset's «now».

import type {
  feedEntryMessages,
  feedSources,
  NewFeedEntry,
  NewMaterial,
} from "../../schema/materials.js";
import { goldenUuid, GOLDEN_GROUP } from "./ids.js";
import { shiftFromNow } from "./now.js";
import { GOLDEN_VOLUME_ORDINAL_BASE } from "./volume.js";

/** The API's `ACADEMY_SOURCE_NAME` and `TELEGRAM_SOURCE_NAME` (048 EARS-9, EARS-26). */
const ACADEMY_SOURCE_NAME = "Академия";
const TELEGRAM_SOURCE_NAME = "BBM Academy · Telegram";

const NEWS = [
  "Открыт набор в школу ортобиологии на весенний поток",
  "Академия запускает цикл эфиров по неотложной кардиологии",
  "Обновлены клинические рекомендации по артериальной гипертензии",
  "Итоги осенней школы неврологии: 1 200 участников",
  "Новый партнёрский проект с областными больницами",
  "Записи эфиров теперь доступны в течение суток",
  "Программа конгресса «Кардиология в первичном звене» опубликована",
  "Баллы НМО за эфиры Академии: как это работает",
  "Открыта регистрация на школу эндокринологии",
  "Расписание эфиров на следующий месяц",
  "Академия в Telegram: подписывайтесь на новости",
  "Как подать тезисы на конгресс: короткая инструкция",
] as const;

const COLUMNS = [
  "Почему пациенты прекращают приём статинов",
  "Пять ошибок при измерении давления на приёме",
  "Боль в спине: когда нужна визуализация",
  "Как говорить с пациентом о снижении веса",
  "Антикоагулянты у пожилых: страх кровотечения и реальный риск",
  "Мигрень: профилактика, о которой забывают",
  "Что изменилось в ведении сахарного диабета за пять лет",
  "Клинический разбор: одышка неясного генеза",
] as const;

const POSTS = [
  "Сегодня в 19:30 — эфир о ранней диагностике сердечной недостаточности. Ссылка на регистрацию в профиле канала.",
  "Опубликовали запись вчерашнего эфира по мигрени. Смотрите на сайте Академии.",
  "Фотографии с конгресса «Кардиология в первичном звене» — спасибо всем участникам!",
  "Напоминаем: приём тезисов на конгресс терапевтов закрывается через десять дней.",
  "Новый курс в школе неврологии: «Головокружение в практике невролога».",
  "Вопрос недели: как вы выбираете антикоагулянт у пациента старше 80 лет? Пишите в комментариях.",
  "Памятка по измерению АД — в закреплённом сообщении.",
  "Эксперты Академии отвечают на вопросы о новых рекомендациях по дислипидемии.",
  "Расписание эфиров на неделю: понедельник — кардиология, среда — неврология, пятница — терапия.",
  "Открыт набор в школу ортобиологии. Количество мест ограничено.",
  "",
  "Итоги месяца: 26 эфиров, 9 новых курсов и 3 школы.",
] as const;

/**
 * The connected sources, as the admin source form and the source check leave
 * them; the failing reason is `SOURCE_CHECK_REASONS.notAMember` verbatim (EARS-31).
 */
const SOURCES = [
  { address: "bbm_academy_news", enabled: true, status: "ok", reason: null },
  { address: "bbm_academy_cardio", enabled: true, status: "ok", reason: null },
  {
    address: "bbm_academy_neuro",
    enabled: true,
    status: "unchecked",
    reason: null,
  },
  {
    address: "bbm_academy_archive",
    enabled: false,
    status: "failing",
    reason: "Бот не состоит в канале",
  },
] as const;

export interface GoldenFeedVolume {
  materials: NewMaterial[];
  feedEntries: NewFeedEntry[];
  feedSources: (typeof feedSources.$inferInsert)[];
  feedEntryMessages: (typeof feedEntryMessages.$inferInsert)[];
}

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** Builds the volume materials, sources and cards for the resolved «now». */
export function buildGoldenFeedVolume(now: Date): GoldenFeedVolume {
  const at = (days: number) => shiftFromNow(now, { days });
  const out: GoldenFeedVolume = {
    materials: [],
    feedEntries: [],
    feedSources: [],
    feedEntryMessages: [],
  };

  const own = [
    ...NEWS.map((title) => ({ kind: "news" as const, title })),
    ...COLUMNS.map((title) => ({ kind: "column" as const, title })),
  ];
  own.forEach((item, i) => {
    const ordinal = GOLDEN_VOLUME_ORDINAL_BASE + i;
    const id = goldenUuid(GOLDEN_GROUP.materials, ordinal);
    const slug = `golden-volume-material-${i + 1}`;
    // Every seventh is still a draft: the admin list shows both states.
    const published = i % 7 !== 6;
    const firstPublishedAt = at(-(2 + i * 4));
    const created = at(-(5 + i * 4));
    const expertId =
      item.kind === "column"
        ? goldenUuid(
            GOLDEN_GROUP.experts,
            GOLDEN_VOLUME_ORDINAL_BASE + (i % 32),
          )
        : null;
    out.materials.push({
      id,
      slug,
      kind: item.kind,
      title: item.title,
      authorLine: item.kind === "news" ? "Редакция Академии" : "",
      expertId,
      partnerOrganisationId: null,
      coverRef: null,
      body: {
        type: "doc",
        content: [
          paragraph(
            `${item.title}. Коротко о главном для практикующего врача: что изменилось, кого это касается и что делать на приёме уже сейчас.`,
          ),
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Подробнее" }],
          },
          paragraph(
            "Материал подготовлен редакцией Академии вместе с экспертами школ. Ссылки на клинические рекомендации и записи эфиров — на страницах школ и в расписании.",
          ),
        ],
      },
      status: published ? "published" : "draft",
      firstPublishedAt: published ? firstPublishedAt : null,
      version: 1,
      createdAt: created,
      updatedAt: published ? firstPublishedAt : created,
    });
    if (!published) return;
    out.feedEntries.push({
      id: goldenUuid(GOLDEN_GROUP.feedEntries, ordinal),
      sourcePlatform: "academy",
      sourceRef: id,
      materialId: id,
      kind: item.kind,
      title: item.title,
      imageRef: null,
      imageUrl: null,
      sourceName: item.kind === "news" ? ACADEMY_SOURCE_NAME : null,
      authorExpertId: expertId,
      partnerOrganisationId: null,
      href: `/materials/${slug}`,
      publishedAt: firstPublishedAt,
      createdAt: firstPublishedAt,
      updatedAt: firstPublishedAt,
    });
  });

  SOURCES.forEach((spec, s) => {
    const sourceId = goldenUuid(
      GOLDEN_GROUP.feedSources,
      GOLDEN_VOLUME_ORDINAL_BASE + s,
    );
    const created = at(-(120 - s * 10));
    const checked = spec.status !== "unchecked";
    out.feedSources.push({
      id: sourceId,
      platform: "telegram",
      address: spec.address,
      enabled: spec.enabled,
      // A chat id is bound by the source check; an unchecked source has none.
      telegramChatId: checked ? -1_009_000_000_000n - BigInt(s) : null,
      status: spec.status,
      statusReason: spec.reason,
      checkedAt: checked ? at(-(3 + s)) : null,
      version: 1,
      createdAt: created,
      updatedAt: checked ? at(-(3 + s)) : created,
    });
    if (spec.status === "unchecked") return;

    POSTS.forEach((text, p) => {
      if ((p + s) % 4 === 3) return;
      // Message ids grow with time, as a channel's do.
      const messageId = 400 + (POSTS.length - p) * 7;
      const ordinal = GOLDEN_VOLUME_ORDINAL_BASE + 1000 + s * 100 + p;
      const entryId = goldenUuid(GOLDEN_GROUP.feedEntries, ordinal);
      const publishedAt = at(-(1 + p * 3 + s));
      // The captionless photo is an album: three parts, one card (EARS-27).
      const album = text === "";
      out.feedEntries.push({
        id: entryId,
        sourcePlatform: "telegram",
        sourceRef: `${sourceId}:${messageId}`,
        materialId: null,
        kind: "post",
        title: text,
        imageRef: null,
        imageUrl: null,
        sourceName: TELEGRAM_SOURCE_NAME,
        authorExpertId: null,
        partnerOrganisationId: null,
        href: `https://t.me/${spec.address}/${messageId}`,
        publishedAt,
        feedSourceId: sourceId,
        mediaGroupId: album ? `golden-album-${s}-${p}` : null,
        durationSeconds: null,
        previewFileId: null,
        previewFileUniqueId: null,
        previewState: null,
        previewAttempts: 0,
        sourceOff: !spec.enabled,
        hiddenAt: null,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      });
      for (let part = 0; part < (album ? 3 : 1); part++) {
        out.feedEntryMessages.push({
          feedSourceId: sourceId,
          messageId: messageId + part,
          feedEntryId: entryId,
          createdAt: publishedAt,
        });
      }
    });
  });

  return out;
}
