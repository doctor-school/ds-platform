// 017 — SEEDED REFERENCE DATA. Do not hand-edit an entry to "fix" its wording:
// this file is a verbatim transcription of a legal instrument, and the platform's
// only correct response to a changed nomenclature is a re-seed from the new order.
//
// ============================ PROVENANCE ============================
// Order      : Приказ Министерства здравоохранения Российской Федерации
//              от 14.05.2026 № 435н «Об утверждении номенклатуры специальностей
//              специалистов, имеющих медицинское и фармацевтическое образование»
// Registered : Минюст России 09.06.2026, рег. № 86977
// In force   : с 01.09.2026 (supersedes приказ № 700н, which expires 31.08.2026)
// Section    : Раздел I — «Номенклатура специальностей специалистов, имеющих
//              высшее образование и (или) дополнительное профессиональное
//              медицинское и фармацевтическое образование»
// Entries    : 118 (Раздел I, verbatim, in the order's own sequence)
// Sources    : https://normativ.kontur.ru/document?documentId=506541&moduleId=1
//              https://www.garant.ru/products/ipo/prime/doc/414269637/
//              (cross-checked line-by-line; both providers identical. The
//              official publication at publication.pravo.gov.ru/document/
//              0001202606100049 is a scanned PDF with no text layer.)
// Retrieved  : 2026-08-26
// ====================================================================
//
// The ENTRY COUNT is a property of this file and of nothing else (017-design §2).
// It is never restated as a literal in schema, service, controller, test or copy;
// every count surface reads `SpecialtyBook.total`, which is derived from here.
//
// Five entries carry a temporal qualifier printed as part of the entry
// («сохраняется до …», «с …»). They are transcribed VERBATIM — the doctor is
// shown what the order says — while `specialtyIdentityName` strips the qualifier
// before the stable code is derived, so a re-dated entry keeps its identity.

/** The nomenclature order this book is seeded from. */
export const MINZDRAV_ORDER = {
  number: "435н",
  date: "2026-05-14",
  registeredWith: "Минюст России 09.06.2026 № 86977",
  inForceFrom: "2026-09-01",
  section: "Раздел I",
  retrievedAt: "2026-08-26",
} as const;

/**
 * The single non-nomenclature member of the book: the catch-all a doctor whose
 * specialty the order does not name falls back to (EARS-3, EARS-8).
 */
export const SPECIALTY_OTHER_NAME = "Другое";

/**
 * Раздел I, verbatim, in the order's own sequence. Transcription rules: the
 * printed wording exactly as published — no translation, no abbreviation, no
 * normalization of «ё», hyphens, slashes or parentheses.
 */
export const RAZDEL_I_NAMES: readonly string[] = [
  "Авиационная и космическая медицина",
  "Акушерство и гинекология",
  "Аллергология и иммунология",
  "Аналитическая токсикология",
  "Анестезиология-реаниматология",
  "Бактериология (сохраняется до 1 сентября 2028 г.)",
  "Вирусология (сохраняется до 1 сентября 2028 г.)",
  "Водолазная медицина",
  "Гастроэнтерология",
  "Гематология",
  "Генетика",
  "Гериатрия",
  "Гигиена детей и подростков",
  "Гигиена питания",
  "Гигиена труда",
  "Гигиеническое воспитание",
  "Дезинфектология",
  "Дерматовенерология",
  "Детская кардиология",
  "Детская онкология",
  "Детская онкология-гематология",
  "Детская урология-андрология",
  "Детская хирургия",
  "Детская эндокринология",
  "Диетология",
  "Инфекционные болезни",
  "Кардиология",
  "Кинезиореабилитация",
  "Клиническая лабораторная диагностика",
  "Клиническая фармакология",
  "Колопроктология",
  "Коммунальная гигиена",
  "Косметология",
  "Лабораторная генетика",
  "Лечебная физкультура и спортивная медицина",
  "Лечебное дело",
  "Мануальная терапия",
  "Медико-профилактическое дело",
  "Медико-социальная экспертиза",
  "Медицинская биология",
  "Медицинская биофизика",
  "Медицинская биохимия",
  "Медицинская зоология",
  "Медицинская кибернетика",
  "Медицинская логопедия",
  "Медицинская микробиология",
  "Медицинская психология",
  "Медицинская физика",
  "Медицинская эмбриология",
  "Медицинский массаж",
  "Неврология",
  "Нейропсихология",
  "Нейрохирургия",
  "Неонатология",
  "Нефрология",
  "Нутрициология",
  "Общая врачебная практика (семейная медицина)",
  "Общая гигиена",
  "Онкология",
  "Организация здравоохранения и общественное здоровье",
  "Ортодонтия",
  "Остеопатия",
  "Оториноларингология",
  "Офтальмология",
  "Паллиативная медицинская помощь (с 1 сентября 2027 г.)",
  "Паразитология (сохраняется до 1 сентября 2028 г.)",
  "Патологическая анатомия",
  "Педиатрия",
  "Пластическая хирургия",
  "Профпатология",
  "Психиатрия",
  "Психиатрия-наркология",
  "Психотерапия",
  "Пульмонология",
  "Радиационная гигиена",
  "Радиология",
  "Радиотерапия",
  "Ревматология",
  "Рентгенология",
  "Рентгенэндоваскулярные диагностика и лечение",
  "Рефлексотерапия",
  "Санитарно-гигиенические лабораторные исследования",
  "Сексология (сохраняется до 1 марта 2027 г.)",
  "Сердечно-сосудистая хирургия",
  "Сестринское дело",
  "Скорая медицинская помощь",
  "Социальная гигиена и организация госсанэпидслужбы",
  "Стоматология",
  "Стоматология детская",
  "Стоматология ортопедическая",
  "Стоматология терапевтическая",
  "Стоматология хирургическая",
  "Судебная экспертиза",
  "Судебно-медицинская экспертиза",
  "Судебно-психиатрическая экспертиза",
  "Сурдология-оториноларингология",
  "Терапия",
  "Токсикология",
  "Торакальная хирургия",
  "Травматология и ортопедия",
  "Трансфузиология",
  "Ультразвуковая диагностика",
  "Управление и экономика фармации",
  "Управление сестринской деятельностью",
  "Урология",
  "Фармацевтическая технология",
  "Фармацевтическая химия и фармакогнозия",
  "Фармация",
  "Физиотерапия",
  "Физическая и реабилитационная медицина",
  "Фтизиатрия",
  "Функциональная диагностика",
  "Хирургия",
  "Челюстно-лицевая хирургия",
  "Эндокринология",
  "Эндоскопия",
  "Эпидемиология",
  "Эргореабилитация",
];

/**
 * The frequent set the search-first catalog (Stage-A variant Б) renders beneath
 * the search field, IN THE ORDER IT IS RENDERED. Source: the approved canvas
 * `design-source/doctor-home.dc.html`  — the decided default, not a lead pick.
 *
 * Every name here must appear verbatim in `RAZDEL_I_NAMES`; the seed builder
 * refuses to load if one does not, so a canvas entry can never quietly become
 * a thirteenth specialty outside the closed book.
 */
export const FREQUENT_SPECIALTY_NAMES: readonly string[] = [
  "Терапия",
  "Педиатрия",
  "Хирургия",
  "Кардиология",
  "Неврология",
  "Акушерство и гинекология",
  "Травматология и ортопедия",
  "Онкология",
  "Анестезиология-реаниматология",
  "Офтальмология",
  "Оториноларингология",
  "Эндокринология",
];
