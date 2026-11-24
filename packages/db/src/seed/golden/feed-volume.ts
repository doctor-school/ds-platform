// #4172 — the materials feed at volume (048); #4192 — at the volume and the
// look of a real one.
//
// The named catalogue carries one news item and its card, so on a slot the
// Academy feed rail, the «Материалы» admin list and the network-source admin
// list render one row or none. This half writes what those read, as the
// product writes it:
//
//   * own materials — news and expert columns, a draft or two among them — and,
//     for every published one, the card `OwnMaterialsFeedSource.write` derives
//     (048 EARS-4): same title, the card date = the first publication instant,
//     the card image = the material's cover (`image_ref = cover_ref`); every
//     third published material carries a cover, stored under the key the cover
//     upload writes (`materials/covers/<request key>-<sha256[:32]>.webp`);
//   * connected Telegram sources (048 slice 2) — working, unchecked and failing,
//     one switched off — and the posts the webhook writes for them: a card per
//     post (`telegram.feed-source.ts`: `sourceRef = <source>:<message>`, the
//     permalink), an album as one card holding each part's message id
//     (EARS-27), the switched-off source's cards `source_off` (EARS-22).
//
// #4192 — every source has its own topics, so no two visible cards share a
// text; a photo post and a video post (with its duration) carry the preview
// `TelegramPreviewService` leaves behind once the copy settled
// (`image_ref = feed-previews/<entry>/<sha256>.webp`, `preview_state = done`,
// the Telegram file ids it copied from), the rest stay text-only; and the four
// working channels together with the own cards give the rail ~200 visible
// entries to page through. The image bytes are committed under
// `media/feed/` and written by the media half (`media.ts`); every instant is a
// whole-day offset from the dataset's «now».

import type {
  feedEntryMessages,
  feedEntryVkObjects,
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
/** The API's `VK_POST_SOURCE_NAME` and `VK_VIDEO_SOURCE_NAME` (048 EARS-41, EARS-42). */
const VK_POST_SOURCE_NAME = "BBM Academy · VK";
const VK_VIDEO_SOURCE_NAME = "BBM Academy · VK Видео";
/** The golden VK community id (bound by the source check, 048 EARS-44). */
const GOLDEN_VK_GROUP_ID = 229_000_001;
/** 048 slice 3 (#4004) — the VK community's wall posts and VK Видео videos. */
const VK_POSTS = 18;
const VK_VIDEOS = 4;

/** The API's `FEED_PREVIEW_PREFIX` and the cover upload's `COVER_PREFIX`. */
const FEED_PREVIEW_PREFIX = "feed-previews";
const COVER_PREFIX = "materials/covers";

/**
 * The committed feed images (`media/feed/<name>.webp`) and the SHA-256 of
 * their bytes. The product names a stored image by the hash of its normalised
 * bytes, so the key is derived from this table; `media.ts` re-hashes the file
 * and refuses a mismatch.
 */
export const GOLDEN_FEED_IMAGES = {
  "photo-1": "d1063ca495a0d648bcd8c0b3989788c0ebbf6189e6bf99e61bde02f205bc2b32",
  "photo-2": "2f683ff9974c71753a97fbebb0e8df5b93773a5ea497ca4ecea06b448e926a46",
  "photo-3": "fd9a29c332b6d4b84786438dde38f611991eee668e3324d4d7fad8c3b27bbf61",
  "photo-4": "999466a5d17da8ccd72b5a3ed0e59438f14f1f32289a1a607a5187af9b8be508",
  "photo-5": "5b98db52f16b6f8d2224e9b8ebaf0ac1ef69ef37e6b9865509d99f7201b1c30d",
  "photo-6": "a34efc937c44454e03021e132fd3fb35df8c5eeb29ede58ccb58d1e0a9c9e54c",
  "photo-7": "ad89afc800f7dacffcc44641f878f787f5c20f66e88435a6a184d14ffd922d65",
  "photo-8": "f2a6e67b707f08afd68665e0dbb0b48cb143ae6fe0c372435186f626ab9c40fb",
  "photo-9": "3f07bd324d88706e2cc6b9904eb5d38016fc326e507dc2f81af376a4db6b8e71",
  "photo-10":
    "763fcdbac425b80cddf6c3b2e8dfcba3b4a22bb725db980683d859b5d2cb8afd",
  "video-1": "18aae1eca474cc2fe7b831b166a41126af821a4d30f5d6a598a4322c97574322",
  "video-2": "14dad3e0f1006023ceb7d37a46a5edd6b3d16d181681ba44e896706caca3b285",
  "video-3": "9fe7c8499654444aaef40457772bca274053dafa7d79bddfdb664b7eace88db3",
  "video-4": "63501f7ba70fe4f2509e04246357bfadd4833f55b7962acbf46dcb4da63ea447",
  "cover-1": "405ae8b8321aeb661cb3ef2c46329e30a3a59a8d7f0f9b6b97ec102693fe6cda",
  "cover-2": "c0969831ccce50693a16d4305cea6ccd5d601e23c4111bb0c91b03b74a6a408f",
  "cover-3": "55c3fa24c6c22f27e25c08d1baf1daa5fcb6555e6fa055483f9e66de015c384e",
  "cover-4": "a21f30f0050ac949ccb71b435abe0751db283c4d32c719a040780ea39a0e5d31",
  "cover-5": "686cf3f324f9a81535bff83fd11a19f943f1202a93f0b6ccd0abe71da9d06bfb",
  "cover-6": "7f831b879c1e1c9704adff6118ccec2b4bf5313ccc4fd2545e7557eb1eac5eb6",
} as const;

export type GoldenFeedImageName = keyof typeof GOLDEN_FEED_IMAGES;

const PHOTOS = Array.from(
  { length: 10 },
  (_, i) => `photo-${i + 1}` as GoldenFeedImageName,
);
const VIDEOS = Array.from(
  { length: 4 },
  (_, i) => `video-${i + 1}` as GoldenFeedImageName,
);
const COVERS = Array.from(
  { length: 6 },
  (_, i) => `cover-${i + 1}` as GoldenFeedImageName,
);

/** The key `TelegramPreviewService` stores a settled preview under. */
export function goldenFeedPreviewKey(
  entryId: string,
  image: GoldenFeedImageName,
): string {
  return `${FEED_PREVIEW_PREFIX}/${entryId}/${GOLDEN_FEED_IMAGES[image]}.webp`;
}

/**
 * The key the material cover upload stores a cover under
 * (`IdempotencyService.objectKeyFor`: `<prefix>/<request key>-<sha256[:32]>`);
 * the golden request key is the material's own id.
 */
export function goldenMaterialCoverKey(
  materialId: string,
  image: GoldenFeedImageName,
): string {
  return `${COVER_PREFIX}/${materialId}-${GOLDEN_FEED_IMAGES[image].slice(0, 32)}.webp`;
}

const PREVIEW_KEY_RE = /^feed-previews\/[0-9a-f-]{36}\/([0-9a-f]{64})\.webp$/;
const COVER_KEY_RE = /^materials\/covers\/[0-9a-f-]{36}-([0-9a-f]{32})\.webp$/;

/** The committed image a golden preview or cover key names, or `null`. */
export function goldenFeedImageOfKey(key: string): GoldenFeedImageName | null {
  const hash = PREVIEW_KEY_RE.exec(key)?.[1] ?? COVER_KEY_RE.exec(key)?.[1];
  if (!hash) return null;
  for (const [name, sha] of Object.entries(GOLDEN_FEED_IMAGES)) {
    if (sha.startsWith(hash)) return name as GoldenFeedImageName;
  }
  return null;
}

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

/** One channel topic: its headline and its «о …» phrase. */
type Topic = readonly [title: string, about: string];

/**
 * A channel's post forms. A source writes every topic in three of them
 * (`postText`), so a source's posts differ from each other and — the topics
 * being the source's own — from every other source's.
 */
const FORMS = 6;
type Media = "photo" | "video" | null;

/** Which preview a post of each form carries — a channel's posts mostly do. */
const FORM_MEDIA: readonly Media[] = [
  "photo", // the эфир announcement banner
  "video", // the recording itself
  null, // a question to the audience
  "photo", // the memo card
  null, // a new case review
  "photo", // the photo report
];

interface SourceSpec {
  address: string;
  enabled: boolean;
  status: "ok" | "unchecked" | "failing";
  reason: string | null;
  /** «в школе кардиологии» — where a case review is published. */
  where: string;
  /** The usual эфир hour, МСК. */
  time: string;
  /** How many times each topic is posted, each time in another form. */
  passes: number;
  topics: readonly Topic[];
}

function postText(spec: SourceSpec, topic: Topic, form: number): string {
  const [title, about] = topic;
  switch (form) {
    case 0:
      return `Сегодня в ${spec.time} — эфир ${about}. Ссылка на регистрацию в профиле канала.`;
    case 1:
      return `Опубликовали запись эфира «${title}». Смотрите на сайте Академии.`;
    case 2:
      return `Эксперты Академии отвечают на вопросы ${about}. Присылайте свои в комментариях.`;
    case 3:
      return `Памятка «${title}» — в закреплённом сообщении.`;
    case 4:
      return `Новый клинический разбор ${spec.where}: «${title}». Случай, ход рассуждений и ссылки на рекомендации.`;
    default:
      return `Фотоотчёт с секции «${title}» — спасибо всем, кто пришёл и задавал вопросы!`;
  }
}

/**
 * The connected sources, as the admin source form and the source check leave
 * them; the failing reason is `SOURCE_CHECK_REASONS.notAMember` verbatim
 * (EARS-31). The first four are the #4172 rows (their ids and message ids are
 * kept), the last two join them in #4192.
 */
const SOURCES: readonly SourceSpec[] = [
  {
    address: "bbm_academy_news",
    enabled: true,
    status: "ok",
    reason: null,
    where: "в Академии",
    time: "19:30",
    passes: 3,
    topics: [
      [
        "Ранняя диагностика сердечной недостаточности",
        "о ранней диагностике сердечной недостаточности",
      ],
      ["Баллы НМО за эфиры Академии", "о баллах НМО за эфиры Академии"],
      [
        "Подача тезисов на конгресс терапевтов",
        "о подаче тезисов на конгресс терапевтов",
      ],
      [
        "Новые клинические рекомендации по гипертензии",
        "о новых клинических рекомендациях по гипертензии",
      ],
      ["Пациент после инсульта", "о пациенте после инсульта"],
      ["Вакцинация взрослых пациентов", "о вакцинации взрослых пациентов"],
      ["Телемедицина в первичном звене", "о телемедицине в первичном звене"],
      [
        "Антибиотики при остром бронхите",
        "об антибиотиках при остром бронхите",
      ],
      ["Хроническая боль на приёме", "о хронической боли на приёме"],
      ["Профилактика выгорания у врачей", "о профилактике выгорания у врачей"],
      ["Онкологический скрининг", "об онкологическом скрининге"],
      ["Лабораторные нормы у пожилых", "о лабораторных нормах у пожилых"],
      ["Цифровые сервисы для врача", "о цифровых сервисах для врача"],
      [
        "Редкий диагноз: как не пропустить",
        "о том, как не пропустить редкий диагноз",
      ],
      [
        "Разговор с родственниками пациента",
        "о разговоре с родственниками пациента",
      ],
    ],
  },
  {
    address: "bbm_academy_cardio",
    enabled: true,
    status: "ok",
    reason: null,
    where: "в школе кардиологии",
    time: "18:00",
    passes: 3,
    topics: [
      [
        "Фибрилляция предсердий у пожилых",
        "о фибрилляции предсердий у пожилых",
      ],
      ["Антикоагулянт после 80 лет", "о выборе антикоагулянта после 80 лет"],
      [
        "Приверженность терапии статинами",
        "о приверженности терапии статинами",
      ],
      ["ЭКГ при боли в груди", "об ЭКГ при боли в груди"],
      [
        "Резистентная артериальная гипертензия",
        "о резистентной артериальной гипертензии",
      ],
      [
        "Сердечная недостаточность с сохранённой фракцией",
        "о сердечной недостаточности с сохранённой фракцией",
      ],
      ["Реабилитация после инфаркта", "о реабилитации после инфаркта"],
      ["Целевые уровни ЛПНП", "о целевых уровнях ЛПНП"],
      ["Синкопе в практике кардиолога", "о синкопе в практике кардиолога"],
      [
        "Миокардит после вирусной инфекции",
        "о миокардите после вирусной инфекции",
      ],
      ["Холтеровское мониторирование", "о холтеровском мониторировании"],
      ["Клапанные пороки у взрослых", "о клапанных пороках у взрослых"],
      ["Лёгочная гипертензия", "о лёгочной гипертензии"],
      ["Кардиоонкология", "о кардиоонкологии"],
      ["Нагрузочные пробы", "о нагрузочных пробах"],
    ],
  },
  {
    address: "bbm_academy_neuro",
    enabled: true,
    status: "unchecked",
    reason: null,
    where: "в школе неврологии",
    time: "19:00",
    passes: 0,
    topics: [],
  },
  {
    address: "bbm_academy_archive",
    enabled: false,
    status: "failing",
    reason: "Бот не состоит в канале",
    where: "в архиве Академии",
    time: "19:30",
    passes: 1,
    topics: [
      ["Итоги весеннего семестра", "об итогах весеннего семестра"],
      ["Первый поток школы ортобиологии", "о первом потоке школы ортобиологии"],
      ["Неотложная кардиология", "о неотложной кардиологии"],
      ["Боль в спине и визуализация", "о боли в спине и визуализации"],
      ["Нарушения сна", "о нарушениях сна"],
      [
        "Тревожные расстройства в общей практике",
        "о тревожных расстройствах в общей практике",
      ],
      ["Ревматоидный артрит", "о ревматоидном артрите"],
      ["Аллергический ринит", "об аллергическом рините"],
      ["Псориаз у взрослых", "о псориазе у взрослых"],
      ["Мочекаменная болезнь", "о мочекаменной болезни"],
      ["Железодефицит без анемии", "о железодефиците без анемии"],
      ["Обследование перед операцией", "об обследовании перед операцией"],
    ],
  },
  {
    address: "bbm_academy_endo",
    enabled: true,
    status: "ok",
    reason: null,
    where: "в школе эндокринологии",
    time: "20:00",
    passes: 3,
    topics: [
      ["Старт инсулинотерапии", "о старте инсулинотерапии"],
      ["Гипотиреоз у беременных", "о гипотиреозе у беременных"],
      [
        "Медикаментозная терапия ожирения",
        "о медикаментозной терапии ожирения",
      ],
      ["Узловой зоб", "об узловом зобе"],
      ["Диабетическая стопа", "о диабетической стопе"],
      ["Остеопороз у мужчин", "об остеопорозе у мужчин"],
      ["Гипогликемия у пожилых", "о гипогликемии у пожилых"],
      ["Надпочечниковая недостаточность", "о надпочечниковой недостаточности"],
      ["Метформин и функция почек", "о метформине и функции почек"],
      ["Дефицит витамина D", "о дефиците витамина D"],
      ["Гестационный диабет", "о гестационном диабете"],
      ["Гиперпаратиреоз", "о гиперпаратиреозе"],
      ["Непрерывный мониторинг глюкозы", "о непрерывном мониторинге глюкозы"],
      ["Синдром поликистозных яичников", "о синдроме поликистозных яичников"],
      ["Тиреотоксикоз", "о тиреотоксикозе"],
    ],
  },
  {
    address: "bbm_academy_therapy",
    enabled: true,
    status: "ok",
    reason: null,
    where: "в школе терапии",
    time: "19:00",
    passes: 3,
    topics: [
      ["Коморбидный пациент на приёме", "о коморбидном пациенте на приёме"],
      ["Анемия неясного генеза", "об анемии неясного генеза"],
      ["Кашель дольше трёх недель", "о кашле дольше трёх недель"],
      ["Повышенные печёночные ферменты", "о повышенных печёночных ферментах"],
      ["Полипрагмазия у пожилых", "о полипрагмазии у пожилых"],
      [
        "Хроническая болезнь почек в первичном звене",
        "о хронической болезни почек в первичном звене",
      ],
      [
        "Гастроэзофагеальная рефлюксная болезнь",
        "о гастроэзофагеальной рефлюксной болезни",
      ],
      [
        "Головокружение на терапевтическом приёме",
        "о головокружении на терапевтическом приёме",
      ],
      ["Бронхиальная астма у взрослых", "о бронхиальной астме у взрослых"],
      ["Ингаляторы при ХОБЛ", "о подборе ингаляторов при ХОБЛ"],
      ["Подагра и гиперурикемия", "о подагре и гиперурикемии"],
      ["Отёки нижних конечностей", "об отёках нижних конечностей"],
      ["Лихорадка неясного генеза", "о лихорадке неясного генеза"],
      ["Синдром раздражённого кишечника", "о синдроме раздражённого кишечника"],
      [
        "Профилактический осмотр взрослых",
        "о профилактическом осмотре взрослых",
      ],
    ],
  },
];

/**
 * The #4172 seed wrote at most twelve posts per source, message ids
 * `400 + 7·j` (j = 1…12, oldest first) under the entry ordinal `… + 12 − j`.
 * A re-seed of a persistent slot meets those cards on their source key and
 * refreshes their columns — `id` included — while `feed_entry_messages` point
 * at that id with no `ON UPDATE`, so a message id the #4172 seed could have
 * written keeps its #4172 ordinal; every later one takes a disjoint range.
 */
const LEGACY_POSTS = 12;

function telegramEntryOrdinal(source: number, age: number): number {
  return age <= LEGACY_POSTS
    ? GOLDEN_VOLUME_ORDINAL_BASE + 1000 + source * 100 + (LEGACY_POSTS - age)
    : GOLDEN_VOLUME_ORDINAL_BASE + 3000 + source * 100 + age;
}

export interface GoldenFeedVolume {
  materials: NewMaterial[];
  feedEntries: NewFeedEntry[];
  feedSources: (typeof feedSources.$inferInsert)[];
  feedEntryMessages: (typeof feedEntryMessages.$inferInsert)[];
  feedEntryVkObjects: (typeof feedEntryVkObjects.$inferInsert)[];
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
    feedEntryVkObjects: [],
  };

  const own = [
    ...NEWS.map((title) => ({ kind: "news" as const, title })),
    ...COLUMNS.map((title) => ({ kind: "column" as const, title })),
  ];
  let covered = 0;
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
    // Every third material carries a cover; the rest render the text card.
    const coverRef =
      i % 3 === 0
        ? goldenMaterialCoverKey(id, COVERS[covered++ % COVERS.length]!)
        : null;
    out.materials.push({
      id,
      slug,
      kind: item.kind,
      title: item.title,
      authorLine: item.kind === "news" ? "Редакция Академии" : "",
      expertId,
      partnerOrganisationId: null,
      coverRef,
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
      imageRef: coverRef,
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
    // Connected before its oldest post (p = 44 is 133 + s days old).
    const created = at(-(140 + s * 2));
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

    const count = spec.topics.length * spec.passes;
    for (let p = 0; p < count; p++) {
      // p = 0 is the newest post; message ids grow with time, as a channel's do.
      const age = count - p;
      const messageId = 400 + age * 7;
      const topic = p % spec.topics.length;
      const pass = Math.floor(p / spec.topics.length);
      // Each pass shifts the form by two, so a topic never repeats a form.
      const form = (topic + pass * 2) % FORMS;
      const text = postText(spec, spec.topics[topic]!, form);
      const entryId = goldenUuid(
        GOLDEN_GROUP.feedEntries,
        telegramEntryOrdinal(s, age),
      );
      const publishedAt = at(-(1 + p * 3 + s));
      // The second-oldest post is a captioned photo album: three parts, one
      // card (EARS-27).
      const album = age === 2;
      const media: Media = album ? "photo" : FORM_MEDIA[form]!;
      const image =
        media === "photo"
          ? PHOTOS[(s * 7 + p) % PHOTOS.length]!
          : media === "video"
            ? VIDEOS[(s + p) % VIDEOS.length]!
            : null;
      out.feedEntries.push({
        id: entryId,
        sourcePlatform: "telegram",
        sourceRef: `${sourceId}:${messageId}`,
        materialId: null,
        kind: "post",
        title: text,
        imageRef: image ? goldenFeedPreviewKey(entryId, image) : null,
        imageUrl: null,
        sourceName: TELEGRAM_SOURCE_NAME,
        authorExpertId: null,
        partnerOrganisationId: null,
        href: `https://t.me/${spec.address}/${messageId}`,
        publishedAt,
        feedSourceId: sourceId,
        mediaGroupId: album ? `golden-album-${s}-${messageId}` : null,
        // A recording runs 5 to 55 minutes.
        durationSeconds: media === "video" ? 300 + ((p * 437) % 3000) : null,
        previewFileId: image ? `golden-tg-file-${s}-${messageId}` : null,
        previewFileUniqueId: image
          ? `golden-tg-unique-${s}-${messageId}`
          : null,
        previewState: image ? "done" : null,
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
    }
  });

  buildVkVolume(out, at);
  return out;
}

/**
 * 048 slice 3 (#4004) — one bound VK community with 22 publications: wall
 * posts on the news channel's topics in their own words, a few VK Видео videos, one post
 * removed in VK (EARS-45, «Удалён в VK» in «Публикации», EARS-47). Previews
 * are referenced VK URLs on production; a slot has no VK, so the volume
 * carries none and the cards render their text layout. Each publication's
 * dedup key is its `feed_entry_vk_objects` row (EARS-43).
 */
function buildVkVolume(
  out: GoldenFeedVolume,
  at: (days: number) => Date,
): void {
  const spec = SOURCES[0]!;
  const ordinal = GOLDEN_VOLUME_ORDINAL_BASE + SOURCES.length;
  const sourceId = goldenUuid(GOLDEN_GROUP.feedSources, ordinal);
  const created = at(-80);
  out.feedSources.push({
    id: sourceId,
    platform: "vk",
    address: "bbm_academy",
    enabled: true,
    vkGroupId: GOLDEN_VK_GROUP_ID,
    vkLastEventAt: at(-1),
    status: "ok",
    statusReason: null,
    checkedAt: at(-1),
    version: 1,
    createdAt: created,
    updatedAt: at(-1),
  });
  const gid = GOLDEN_VK_GROUP_ID;
  for (let i = 0; i < VK_POSTS + VK_VIDEOS; i++) {
    const video = i % 6 === 5;
    const objectId = 100 + i * 3;
    const entryId = goldenUuid(
      GOLDEN_GROUP.feedEntries,
      GOLDEN_VOLUME_ORDINAL_BASE + 5000 + i,
    );
    const publishedAt = at(-(2 + i * 3));
    const topic = spec.topics[i % spec.topics.length]!;
    out.feedEntries.push({
      id: entryId,
      sourcePlatform: "vk",
      sourceRef: `${sourceId}:${video ? "video" : "post"}:${objectId}`,
      materialId: null,
      kind: video ? "video" : "post",
      title: video
        ? `Запись эфира: ${topic[0]}`
        : `${topic[0]}: разбор ${i + 1} в сообществе Академии ВКонтакте — коротко о главном и ссылка на запись эфира.`,
      imageRef: null,
      imageUrl: null,
      sourceName: video ? VK_VIDEO_SOURCE_NAME : VK_POST_SOURCE_NAME,
      authorExpertId: null,
      partnerOrganisationId: null,
      href: video
        ? `https://vk.com/video-${gid}_${objectId}`
        : `https://vk.com/wall-${gid}_${objectId}`,
      publishedAt,
      feedSourceId: sourceId,
      durationSeconds: video ? 1200 + ((i * 437) % 2400) : null,
      sourceOff: false,
      hiddenAt: null,
      // The seventh post was deleted on the wall (EARS-45).
      removedAt: i === 7 ? at(-(1 + i)) : null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
    });
    out.feedEntryVkObjects.push({
      feedSourceId: sourceId,
      objectKind: video ? "video" : "post",
      vkObjectId: objectId,
      feedEntryId: entryId,
      createdAt: publishedAt,
    });
  }
}
