// #2213 — the authored TAXONOMY catalogue of the golden dataset.
//
// `volume.ts` lays out a season of эфиры; this module lays out what the platform
// classifies them BY. It is pure data — no instants, no ids, no derivation from
// «now» — because a direction is editorial content, not a function of the pin:
// the rows in `volume.ts` stamp it with the instants and the ordinals.
//
// Why it exists at all. The doctor feed is not filtered by `events.specialties`;
// it is resolved through `direction_specialties` → `directions` →
// `event_directions` (017 EARS-8, `TargetingService.resolve`). With an empty
// `directions` table EVERY doctor who has chosen a specialty sees an empty feed,
// whatever the calendar holds — which is exactly what the owner walked into on
// the Stage-B slot of PR #2216. So the invariant this catalogue exists to hold
// is stronger than «some directions exist»:
//
//   every one of the 118 `RAZDEL_I_NAMES` resolves to at least one PUBLISHED
//   direction, and that direction carries at least one upcoming published эфир.
//
// The first half of that invariant is why {@link GOLDEN_DIRECTIONS} is a
// PARTITION: each of the 118 official specialties appears under exactly one
// published direction, so coverage is a property of the literal below rather
// than of a catch-all «Другое» direction that would make every starved specialty
// look served. («Другое» itself is NOT in the book — `TargetingService` answers
// `mode: 'general'` for it and never reads a direction, so it needs no link.)
//
// Thirty-eight published directions is an OUTPUT of that partition, not a
// target: grouping 118 nomenclature entries into coherent therapeutic areas
// needs this many, and a shorter list would either merge unrelated specialties
// under one heading or leave the long tail to a catch-all.

/** A direction and the official specialties it serves. */
export interface GoldenDirectionSpec {
  slug: string;
  title: string;
  status: "draft" | "published" | "retired";
  /** Verbatim `RAZDEL_I_NAMES` members — resolved to book ids at seed time. */
  specialties: readonly string[];
}

/**
 * The published directions, partitioning the whole Минздрав book.
 *
 * Order is the authored order and it is load-bearing twice: it fixes each
 * direction's ordinal (and therefore its uuid), and the event round-robin in
 * `volume.ts` walks it, so re-ordering this array re-identifies rows and
 * re-classifies the season. Append, never insert.
 */
export const GOLDEN_PUBLISHED_DIRECTIONS: readonly GoldenDirectionSpec[] = [
  {
    slug: "cardiology",
    title: "Кардиология",
    status: "published",
    specialties: [
      "Кардиология",
      "Детская кардиология",
      "Сердечно-сосудистая хирургия",
      "Рентгенэндоваскулярные диагностика и лечение",
    ],
  },
  {
    slug: "endocrinology",
    title: "Эндокринология",
    status: "published",
    specialties: ["Эндокринология", "Детская эндокринология"],
  },
  {
    slug: "neurology",
    title: "Неврология",
    status: "published",
    specialties: [
      "Неврология",
      "Нейрохирургия",
      "Нейропсихология",
      "Медицинская логопедия",
    ],
  },
  {
    slug: "gastroenterology",
    title: "Гастроэнтерология",
    status: "published",
    specialties: ["Гастроэнтерология", "Колопроктология", "Эндоскопия"],
  },
  {
    slug: "pulmonology",
    title: "Пульмонология и фтизиатрия",
    status: "published",
    specialties: ["Пульмонология", "Фтизиатрия", "Торакальная хирургия"],
  },
  {
    slug: "rheumatology",
    title: "Ревматология",
    status: "published",
    specialties: ["Ревматология"],
  },
  {
    slug: "allergology",
    title: "Аллергология и иммунология",
    status: "published",
    specialties: ["Аллергология и иммунология"],
  },
  {
    slug: "oncology",
    title: "Онкология",
    status: "published",
    specialties: [
      "Онкология",
      "Детская онкология",
      "Детская онкология-гематология",
    ],
  },
  {
    slug: "pediatrics",
    title: "Педиатрия",
    status: "published",
    specialties: ["Педиатрия", "Неонатология", "Детская хирургия"],
  },
  {
    slug: "general-practice",
    title: "Терапия и общая практика",
    status: "published",
    specialties: [
      "Терапия",
      "Общая врачебная практика (семейная медицина)",
      "Лечебное дело",
    ],
  },
  {
    slug: "obstetrics",
    title: "Акушерство и гинекология",
    status: "published",
    specialties: ["Акушерство и гинекология"],
  },
  {
    slug: "urology",
    title: "Урология и нефрология",
    status: "published",
    specialties: ["Урология", "Нефрология", "Детская урология-андрология"],
  },
  {
    slug: "dermatology",
    title: "Дерматология и косметология",
    status: "published",
    specialties: ["Дерматовенерология", "Косметология"],
  },
  {
    slug: "psychiatry",
    title: "Психиатрия и психотерапия",
    status: "published",
    specialties: [
      "Психиатрия",
      "Психиатрия-наркология",
      "Психотерапия",
      "Медицинская психология",
      "Сексология (сохраняется до 1 марта 2027 г.)",
    ],
  },
  {
    slug: "infectious",
    title: "Инфекционные болезни",
    status: "published",
    specialties: ["Инфекционные болезни"],
  },
  {
    slug: "hematology",
    title: "Гематология и трансфузиология",
    status: "published",
    specialties: ["Гематология", "Трансфузиология"],
  },
  {
    slug: "surgery",
    title: "Хирургия",
    status: "published",
    specialties: [
      "Хирургия",
      "Пластическая хирургия",
      "Челюстно-лицевая хирургия",
    ],
  },
  {
    slug: "traumatology",
    title: "Травматология и ортопедия",
    status: "published",
    specialties: ["Травматология и ортопедия"],
  },
  {
    slug: "ophthalmology",
    title: "Офтальмология",
    status: "published",
    specialties: ["Офтальмология"],
  },
  {
    slug: "otorhinolaryngology",
    title: "Оториноларингология",
    status: "published",
    specialties: ["Оториноларингология", "Сурдология-оториноларингология"],
  },
  {
    slug: "dentistry",
    title: "Стоматология",
    status: "published",
    specialties: [
      "Стоматология",
      "Стоматология детская",
      "Стоматология ортопедическая",
      "Стоматология терапевтическая",
      "Стоматология хирургическая",
      "Ортодонтия",
    ],
  },
  {
    slug: "anesthesiology",
    title: "Анестезиология и неотложная помощь",
    status: "published",
    specialties: ["Анестезиология-реаниматология", "Скорая медицинская помощь"],
  },
  {
    slug: "toxicology",
    title: "Токсикология",
    status: "published",
    specialties: ["Токсикология", "Аналитическая токсикология"],
  },
  {
    slug: "radiology",
    title: "Лучевая и функциональная диагностика",
    status: "published",
    specialties: [
      "Рентгенология",
      "Радиология",
      "Радиотерапия",
      "Ультразвуковая диагностика",
      "Функциональная диагностика",
    ],
  },
  {
    slug: "laboratory",
    title: "Лабораторная диагностика и микробиология",
    status: "published",
    specialties: [
      "Клиническая лабораторная диагностика",
      "Медицинская микробиология",
      "Бактериология (сохраняется до 1 сентября 2028 г.)",
      "Вирусология (сохраняется до 1 сентября 2028 г.)",
      "Паразитология (сохраняется до 1 сентября 2028 г.)",
    ],
  },
  {
    slug: "genetics",
    title: "Генетика",
    status: "published",
    specialties: ["Генетика", "Лабораторная генетика"],
  },
  {
    slug: "clinical-pharmacology",
    title: "Клиническая фармакология",
    status: "published",
    specialties: ["Клиническая фармакология"],
  },
  {
    slug: "pharmacy",
    title: "Фармация",
    status: "published",
    specialties: [
      "Фармация",
      "Фармацевтическая технология",
      "Фармацевтическая химия и фармакогнозия",
      "Управление и экономика фармации",
    ],
  },
  {
    slug: "rehabilitation",
    title: "Реабилитация и физиотерапия",
    status: "published",
    specialties: [
      "Физиотерапия",
      "Физическая и реабилитационная медицина",
      "Лечебная физкультура и спортивная медицина",
      "Мануальная терапия",
      "Остеопатия",
      "Рефлексотерапия",
      "Медицинский массаж",
      "Кинезиореабилитация",
      "Эргореабилитация",
    ],
  },
  {
    slug: "nutrition",
    title: "Диетология и нутрициология",
    status: "published",
    specialties: ["Диетология", "Нутрициология"],
  },
  {
    slug: "palliative",
    title: "Паллиативная помощь и гериатрия",
    status: "published",
    specialties: [
      "Паллиативная медицинская помощь (с 1 сентября 2027 г.)",
      "Гериатрия",
    ],
  },
  {
    slug: "hygiene",
    title: "Гигиена и эпидемиология",
    status: "published",
    specialties: [
      "Эпидемиология",
      "Общая гигиена",
      "Гигиена детей и подростков",
      "Гигиена питания",
      "Гигиена труда",
      "Гигиеническое воспитание",
      "Коммунальная гигиена",
      "Радиационная гигиена",
      "Дезинфектология",
      "Медико-профилактическое дело",
      "Санитарно-гигиенические лабораторные исследования",
    ],
  },
  {
    slug: "health-management",
    title: "Организация здравоохранения",
    status: "published",
    specialties: [
      "Организация здравоохранения и общественное здоровье",
      "Социальная гигиена и организация госсанэпидслужбы",
    ],
  },
  {
    slug: "nursing",
    title: "Сестринское дело",
    status: "published",
    specialties: ["Сестринское дело", "Управление сестринской деятельностью"],
  },
  {
    slug: "pathology",
    title: "Патология и судебная экспертиза",
    status: "published",
    specialties: [
      "Патологическая анатомия",
      "Судебная экспертиза",
      "Судебно-медицинская экспертиза",
      "Судебно-психиатрическая экспертиза",
    ],
  },
  {
    slug: "occupational",
    title: "Профессиональная и экстремальная медицина",
    status: "published",
    specialties: [
      "Профпатология",
      "Авиационная и космическая медицина",
      "Водолазная медицина",
      "Медико-социальная экспертиза",
    ],
  },
  {
    slug: "biomedical",
    title: "Медико-биологические науки",
    status: "published",
    specialties: [
      "Медицинская биология",
      "Медицинская биофизика",
      "Медицинская биохимия",
      "Медицинская зоология",
      "Медицинская эмбриология",
    ],
  },
  {
    slug: "medical-physics",
    title: "Медицинская физика и кибернетика",
    status: "published",
    specialties: ["Медицинская физика", "Медицинская кибернетика"],
  },
];

/**
 * The non-published directions.
 *
 * `taxonomy_status` has three members and an admin list that only ever shows one
 * of them cannot demonstrate the filter, the retire action or the «черновик»
 * badge. Their specialty links are ADDITIVE — every name they mention is already
 * covered by a published direction above — so the partition's coverage invariant
 * is untouched no matter what happens to these three rows.
 */
export const GOLDEN_UNPUBLISHED_DIRECTIONS: readonly GoldenDirectionSpec[] = [
  {
    slug: "digital-medicine",
    title: "Цифровая медицина",
    status: "draft",
    specialties: [
      "Медицинская кибернетика",
      "Организация здравоохранения и общественное здоровье",
    ],
  },
  {
    slug: "sports-medicine",
    title: "Спортивная медицина",
    status: "draft",
    specialties: [
      "Лечебная физкультура и спортивная медицина",
      "Травматология и ортопедия",
    ],
  },
  {
    slug: "burnout-prevention",
    title: "Профилактика профессионального выгорания",
    status: "retired",
    specialties: [],
  },
];

/** Every direction the golden seed writes, published ones first. */
export const GOLDEN_DIRECTIONS: readonly GoldenDirectionSpec[] = [
  ...GOLDEN_PUBLISHED_DIRECTIONS,
  ...GOLDEN_UNPUBLISHED_DIRECTIONS,
];

/**
 * Extra ACTIVE links, on top of the partition.
 *
 * The partition alone makes `direction_specialties` look one-to-many, and the
 * admin's «Связи специальностей» page exists because it is not: a specialty may
 * legitimately be served by several directions. Each pair below names a
 * specialty that a second direction genuinely covers.
 */
export const GOLDEN_DIRECTION_EXTRA_LINKS: readonly (readonly [
  string,
  string,
])[] = [
  ["cardiology", "Терапия"],
  ["pediatrics", "Детская кардиология"],
  ["rehabilitation", "Травматология и ортопедия"],
  ["palliative", "Сестринское дело"],
];

/**
 * RETIRED links — the second member of `relationship_status`.
 *
 * Every one is a DUPLICATE of a link the partition already carries actively, or
 * sits on a direction that is not published, so retiring it cannot take the last
 * active link away from any specialty. That is the property that keeps the
 * coverage invariant a property of the data rather than of this list's contents.
 */
export const GOLDEN_DIRECTION_RETIRED_LINKS: readonly (readonly [
  string,
  string,
])[] = [
  ["burnout-prevention", "Психотерапия"],
  ["oncology", "Гематология"],
  ["psychiatry", "Неврология"],
  ["nutrition", "Эндокринология"],
];

/** One directed edge of the «смежные направления» graph. */
export interface GoldenAdjacencyEdge {
  from: string;
  to: string;
  kind: "related" | "subdiscipline" | "interdisciplinary";
  /** 1..100; `findAdjacentDirections` orders by it descending. */
  weight: number;
}

/**
 * The adjacency graph.
 *
 * DIRECTED (`direction_adjacency_pair_key` is on the ordered pair), so a mutual
 * relation is two authored rows and most edges here are deliberately one-way:
 * «кардиологу полезна лучевая диагностика» does not imply the reverse for a
 * radiologist's feed. Weight is the relative strength within the SOURCE
 * direction's adjacent set, which is why the same pair can carry different
 * weights in its two orientations.
 */
export const GOLDEN_ADJACENCY: readonly GoldenAdjacencyEdge[] = [
  // ── related: the same clinical neighbourhood ────────────────────────────
  e("general-practice", "cardiology", "related", 90),
  e("cardiology", "general-practice", "related", 85),
  e("cardiology", "endocrinology", "related", 80),
  e("endocrinology", "cardiology", "related", 78),
  e("endocrinology", "nutrition", "related", 75),
  e("nutrition", "endocrinology", "related", 72),
  e("neurology", "psychiatry", "related", 82),
  e("psychiatry", "neurology", "related", 80),
  e("gastroenterology", "general-practice", "related", 76),
  e("pulmonology", "infectious", "related", 78),
  e("infectious", "pulmonology", "related", 76),
  e("pulmonology", "allergology", "related", 70),
  e("allergology", "pulmonology", "related", 68),
  e("allergology", "dermatology", "related", 66),
  e("rheumatology", "general-practice", "related", 62),
  e("oncology", "hematology", "related", 84),
  e("hematology", "oncology", "related", 82),
  e("oncology", "palliative", "related", 79),
  e("pediatrics", "general-practice", "related", 71),
  e("pediatrics", "infectious", "related", 67),
  e("pediatrics", "otorhinolaryngology", "related", 59),
  e("obstetrics", "pediatrics", "related", 81),
  e("obstetrics", "urology", "related", 48),
  e("surgery", "anesthesiology", "related", 86),
  e("anesthesiology", "surgery", "related", 84),
  e("traumatology", "rehabilitation", "related", 83),
  e("rehabilitation", "traumatology", "related", 81),
  e("laboratory", "genetics", "related", 65),
  e("genetics", "biomedical", "related", 60),
  e("clinical-pharmacology", "pharmacy", "related", 88),
  e("pharmacy", "clinical-pharmacology", "related", 85),
  e("palliative", "nursing", "related", 74),
  e("nursing", "palliative", "related", 72),
  e("hygiene", "infectious", "related", 77),
  e("hygiene", "health-management", "related", 64),
  e("occupational", "hygiene", "related", 63),
  e("biomedical", "medical-physics", "related", 55),

  // ── subdiscipline: the source is a narrower field of the target ─────────
  e("urology", "surgery", "subdiscipline", 57),
  e("surgery", "traumatology", "subdiscipline", 75),
  e("otorhinolaryngology", "surgery", "subdiscipline", 46),
  e("dentistry", "surgery", "subdiscipline", 43),
  e("pathology", "laboratory", "subdiscipline", 67),
  e("hematology", "laboratory", "subdiscipline", 62),

  // ── interdisciplinary: different fields, shared patient route ───────────
  e("cardiology", "radiology", "interdisciplinary", 70),
  e("cardiology", "clinical-pharmacology", "interdisciplinary", 65),
  e("cardiology", "rehabilitation", "interdisciplinary", 60),
  e("endocrinology", "obstetrics", "interdisciplinary", 55),
  e("neurology", "rehabilitation", "interdisciplinary", 74),
  e("neurology", "radiology", "interdisciplinary", 66),
  e("neurology", "ophthalmology", "interdisciplinary", 45),
  e("gastroenterology", "surgery", "interdisciplinary", 64),
  e("gastroenterology", "nutrition", "interdisciplinary", 68),
  e("gastroenterology", "infectious", "interdisciplinary", 50),
  e("rheumatology", "traumatology", "interdisciplinary", 58),
  e("rheumatology", "laboratory", "interdisciplinary", 52),
  e("oncology", "radiology", "interdisciplinary", 80),
  e("oncology", "surgery", "interdisciplinary", 77),
  e("oncology", "pathology", "interdisciplinary", 73),
  e("oncology", "genetics", "interdisciplinary", 69),
  e("pediatrics", "dentistry", "interdisciplinary", 41),
  e("general-practice", "clinical-pharmacology", "interdisciplinary", 63),
  e("general-practice", "laboratory", "interdisciplinary", 61),
  e("general-practice", "health-management", "interdisciplinary", 40),
  e("urology", "oncology", "interdisciplinary", 53),
  e("dermatology", "oncology", "interdisciplinary", 49),
  e("dermatology", "infectious", "interdisciplinary", 44),
  e("psychiatry", "palliative", "interdisciplinary", 42),
  e("psychiatry", "occupational", "interdisciplinary", 38),
  e("anesthesiology", "toxicology", "interdisciplinary", 51),
  e("toxicology", "laboratory", "interdisciplinary", 54),
  e("radiology", "medical-physics", "interdisciplinary", 72),
  e("medical-physics", "radiology", "interdisciplinary", 70),
  e("laboratory", "biomedical", "interdisciplinary", 56),
  e("nutrition", "rehabilitation", "interdisciplinary", 45),
  e("health-management", "nursing", "interdisciplinary", 58),
];

/**
 * Edges the editor has since withdrawn.
 *
 * `relationship_status` has two members, and «связь снята» is a state the admin
 * has to be able to show. Neither of these is any direction's only edge, so the
 * graph stays fully connected in the active projection.
 */
export const GOLDEN_ADJACENCY_RETIRED: readonly GoldenAdjacencyEdge[] = [
  e("ophthalmology", "endocrinology", "interdisciplinary", 47),
  e("occupational", "rehabilitation", "interdisciplinary", 39),
];

function e(
  from: string,
  to: string,
  kind: GoldenAdjacencyEdge["kind"],
  weight: number,
): GoldenAdjacencyEdge {
  return { from, to, kind, weight };
}

/** A sponsoring organization. All fictional — no real brand appears here. */
export interface GoldenPartnerSpec {
  slug: string;
  title: string;
  status: "draft" | "published" | "retired";
  /** `null` is a rendered state of its own: «партнёр без сайта». */
  website: string | null;
}

/**
 * The partner catalogue.
 *
 * Fourteen rows so «Партнёры» is a list with a page of its own rather than a
 * demo row, spread over all three `taxonomy_status` members and over both sides
 * of the nullable `website_url`. Every name is invented: a staging box carrying
 * a real pharmaceutical brand next to fabricated эфиры is a legal problem, not a
 * fixture detail.
 */
export const GOLDEN_PARTNERS: readonly GoldenPartnerSpec[] = [
  p("avista-farm", "Ависта Фарм", "published"),
  p("mediprim-rus", "Медиприм Рус", "published"),
  p("nordmed-labs", "Нордмед Лабс", "published"),
  p("kardiolink-systems", "Кардиолинк Системс", "published"),
  { slug: "bioresurs-grupp", title: "Биоресурс Групп", status: "published", website: null },
  p("gelios-medikal", "Гелиос Медикал", "published"),
  p("terravita-farm", "Терравита Фарм", "published"),
  p("sinaps-diagnostika", "Синапс Диагностика", "published"),
  p("vektor-implanty", "Вектор Импланты", "published"),
  p("artemida-helskea", "Артемида Хелскеа", "published"),
  p("polimed-inzhiniring", "Полимед Инжиниринг", "published"),
  p("ortomedika-plyus", "Ортомедика Плюс", "draft"),
  { slug: "cerebra-bio", title: "Церебра Био", status: "draft", website: null },
  p("akvilegiya-farm", "Аквилегия Фарм", "retired"),
];

function p(
  slug: string,
  title: string,
  status: GoldenPartnerSpec["status"],
): GoldenPartnerSpec {
  return { slug, title, status, website: `https://${slug}.example` };
}

/** Direction slug → its index in {@link GOLDEN_PUBLISHED_DIRECTIONS}. */
const PUBLISHED_INDEX_BY_SLUG = new Map(
  GOLDEN_PUBLISHED_DIRECTIONS.map((spec, index) => [spec.slug, index]),
);

/** Direction slug → its index in {@link GOLDEN_DIRECTIONS}. */
const INDEX_BY_SLUG = new Map(
  GOLDEN_DIRECTIONS.map((spec, index) => [spec.slug, index]),
);

/** Raised when the catalogue itself is inconsistent — a fixture defect. */
export class GoldenTaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenTaxonomyError";
  }
}

/** The index of a direction in {@link GOLDEN_DIRECTIONS}, by slug. */
export function directionIndexOf(slug: string): number {
  const index = INDEX_BY_SLUG.get(slug);
  if (index === undefined) {
    throw new GoldenTaxonomyError(`unknown golden direction slug: ${slug}`);
  }
  return index;
}

/**
 * Specialty name → the index of the published direction that owns it.
 *
 * Built from the PARTITION only, so the answer is unambiguous: the extra links
 * add second directions to a specialty but never move the one this map returns.
 * `volume.ts` uses it to classify an эфир under the direction that matches the
 * specialty its title names — the classification an editor would have made.
 */
const PUBLISHED_INDEX_BY_SPECIALTY = new Map<string, number>(
  GOLDEN_PUBLISHED_DIRECTIONS.flatMap((spec, index) =>
    spec.specialties.map((name) => [name, index] as const),
  ),
);

/** The published direction that owns a specialty, as an index. */
export function publishedDirectionIndexOfSpecialty(name: string): number {
  const index = PUBLISHED_INDEX_BY_SPECIALTY.get(name);
  if (index === undefined) {
    throw new GoldenTaxonomyError(
      `no golden direction owns the specialty "${name}" — the catalogue must partition RAZDEL_I_NAMES`,
    );
  }
  return index;
}

/** The index a published direction slug addresses within the published half. */
export function publishedDirectionIndexOf(slug: string): number {
  const index = PUBLISHED_INDEX_BY_SLUG.get(slug);
  if (index === undefined) {
    throw new GoldenTaxonomyError(
      `unknown published golden direction slug: ${slug}`,
    );
  }
  return index;
}
