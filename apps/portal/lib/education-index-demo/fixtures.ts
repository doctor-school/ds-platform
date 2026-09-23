/**
 * 045 EARS-2 — the ONE static fixture module behind both education-index demo
 * pages (`/education-index`, `/education-index/partner-demo`). No network, API
 * or DB call reads or writes anything here; the pages import these constants at
 * build time and render them.
 *
 * Source of every number: design prompt 23
 * (`specs/product/two-site-ia/design-prompts-ru/23-a-index-demo-ru.md`) as drawn
 * by the vendored canvas `design-source/academy-index-demo.dc.html`. Fixture
 * invariants (045 requirements «Invariants», prompt l.97): investment shares sum
 * to 100, attention shares sum to 100, investments sum to 13 600 000 ₽, top-5 =
 * 80 % of investment.
 *
 * `weeklySeries` carries exactly what the prompt gives (045-design «Fixture
 * module»): the full week 1–4 index series for places 1–3 (the dynamics chart's
 * subjects, EARS-7) and ONE week-3 value for places 4–12 (the source of the rank
 * delta, prompt l.122). Weeks 1–2 for places 4–12 are never invented.
 *
 * TEMPORARY: deleted with both routes in the release that ships 032 and 035
 * (EARS-14).
 */

/** The 14×14 geometric mark in an organisation emblem (canvas `MK`). */
export type EmblemMark =
  | "romb"
  | "semis"
  | "ring"
  | "tri"
  | "notch"
  | "stripes"
  | "hex"
  | "drop"
  | "cross"
  | "wave"
  | "half"
  | "diag";

export interface Emblem {
  /** Two-letter monogram. */
  mono: string;
  /**
   * The fictional organisation's identity plate colour (canvas `plate`). This is
   * data — the organisation's own colour, like a logo — not a design-system
   * styling value; the design system has no per-organisation palette.
   */
  plate: string;
  /** Monogram/mark colour on the plate: light or dark ink (canvas `fg`). */
  ink: "light" | "dark";
  mark: EmblemMark;
}

export interface Organization {
  /** Place in week 4 (the current slice), 1–12. */
  rank: number;
  name: string;
  emblem: Emblem;
  /** Composite index, week 4, leader = 100. */
  index: number;
  investmentRub: number;
  /** Percent of all investment (sums to 100). */
  investmentShare: number;
  /** Percent of all doctor attention (sums to 100). */
  attentionShare: number;
  doctors: number;
  lessons: number;
  events: number;
}

const org = (
  rank: number,
  name: string,
  mono: string,
  plate: string,
  ink: Emblem["ink"],
  mark: EmblemMark,
  index: number,
  investmentRub: number,
  investmentShare: number,
  attentionShare: number,
  doctors: number,
  lessons: number,
  events: number,
): Organization => ({
  rank,
  name,
  emblem: { mono, plate, ink, mark },
  index,
  investmentRub,
  investmentShare,
  attentionShare,
  doctors,
  lessons,
  events,
});

/** The 12 fictional organisations, week-4 order (prompt 23 l.97–115, canvas `orgs`). */
export const organizations: readonly Organization[] = [
  org(1, "Карталис Фарма", "КФ", "oklch(.5 .15 258)", "light", "romb", 100, 3_400_000, 25, 22, 1820, 42, 9),
  org(2, "Велтора Фарм", "ВФ", "oklch(.52 .09 195)", "light", "semis", 79, 2_720_000, 20, 17, 1460, 34, 7),
  org(3, "Ортелла Биотех", "ОБ", "oklch(.52 .13 150)", "light", "ring", 72, 2_040_000, 15, 19, 1240, 28, 6),
  org(4, "Фортакс Биофарм", "ФБ", "oklch(.48 .15 295)", "light", "tri", 49, 1_500_000, 11, 12, 890, 21, 4),
  org(5, "Эвкрит Фарма", "ЭФ", "oklch(.55 .15 48)", "light", "notch", 36, 1_224_000, 9, 8, 610, 16, 3),
  org(6, "Претона Биосистемс", "ПБ", "oklch(.48 .16 340)", "light", "stripes", 26, 680_000, 5, 7, 540, 12, 3),
  org(7, "Калинта Медтех", "КМ", "oklch(.78 .09 225)", "dark", "hex", 19, 544_000, 4, 5, 380, 9, 2),
  org(8, "Селмира Фарма", "СФ", "oklch(.8 .13 82)", "dark", "drop", 14, 476_000, 3.5, 3, 260, 6, 1),
  org(9, "Острана Медтех", "ОМ", "oklch(.38 .012 250)", "light", "cross", 12, 340_000, 2.5, 3, 230, 5, 1),
  org(10, "Кверион Фарма", "КВ", "oklch(.5 .17 12)", "light", "wave", 9, 272_000, 2, 2, 150, 4, 1),
  org(11, "Имбрель Медикал", "ИМ", "oklch(.55 .09 118)", "light", "half", 6, 204_000, 1.5, 1.5, 110, 3, 1),
  org(12, "Равестра Медтех", "РМ", "oklch(.52 .04 245)", "light", "diag", 4, 200_000, 1.5, 0.5, 70, 2, 1),
];

/**
 * Index per organisation per week (weeks 1–4 from the 1 September 2026 launch).
 * Places 1–3: the full series (prompt l.120). Places 4–12: week 3 only
 * (prompt l.122) — the other weeks are absent, never interpolated.
 */
export const weeklySeries: Readonly<
  Record<string, Readonly<Partial<Record<1 | 2 | 3 | 4, number>>>>
> = {
  "Карталис Фарма": { 1: 100, 2: 100, 3: 100, 4: 100 },
  "Велтора Фарм": { 1: 84, 2: 82, 3: 80, 4: 79 },
  "Ортелла Биотех": { 1: 38, 2: 43, 3: 47, 4: 72 },
  "Фортакс Биофарм": { 3: 53 },
  "Эвкрит Фарма": { 3: 48 },
  "Калинта Медтех": { 3: 24 },
  "Претона Биосистемс": { 3: 22 },
  "Селмира Фарма": { 3: 15 },
  "Острана Медтех": { 3: 12 },
  "Кверион Фарма": { 3: 9 },
  "Имбрель Медикал": { 3: 7 },
  "Равестра Медтех": { 3: 4 },
};

/** The index launch date — week 1 is the first slice, nothing exists before it (EARS-7). */
export const INDEX_LAUNCH = "1 сентября 2026";

/** The current slice the leaderboard shows. */
export const CURRENT_WEEK = 4;

/**
 * Week-over-week rank delta, derived from the week-3 slice (prompt l.122):
 * positive = moved up. Ортелла 5→3 = +2, Фортакс 3→4 = −1, and so on; the deltas
 * sum to 0.
 */
export function rankDelta(name: string): number {
  const byWeek3 = organizations
    .map((o) => ({ name: o.name, value: weeklySeries[o.name]?.[3] ?? 0 }))
    .sort((a, b) => b.value - a.value);
  const week3Rank = byWeek3.findIndex((o) => o.name === name) + 1;
  const current = organizations.find((o) => o.name === name);
  if (!current || week3Rank === 0) {
    throw new Error(`045 fixture: unknown organisation «${name}»`);
  }
  return week3Rank - current.rank;
}

/** The three market-wide plates above the leaderboard (prompt l.61, canvas `heroPlates`). */
export const heroPlates = [
  {
    value: "13,6 млн ₽",
    caption: "инвестировано в образование врачей",
    note: "12 партнёров · с 1 сентября 2026",
  },
  {
    value: "5 930",
    caption: "врачей обучено",
    note: "врач, учившийся у нескольких партнёров, учтён один раз",
  },
  {
    value: "182",
    caption: "урока создано",
    note: "уроки, курсы и школы партнёров индекса",
  },
] as const;

/** «Топ-5 партнёров дают 80% инвестиций» — the tail share of the other 7 (prompt l.118). */
export const TOP5_TAIL_SHARE = 20;

/** «Новости индекса», week 4 (canvas `news`). */
export const news: readonly { organization: string; title: string }[] = [
  { organization: "Ортелла Биотех", title: "Ортелла Биотех вошла в тройку лидеров индекса" },
  { organization: "Карталис Фарма", title: "Карталис Фарма — первая четвёртую неделю подряд" },
  { organization: "Претона Биосистемс", title: "Претона Биосистемс поднялась на 6-е место" },
];

export function organizationByName(name: string): Organization {
  const found = organizations.find((o) => o.name === name);
  if (!found) throw new Error(`045 fixture: unknown organisation «${name}»`);
  return found;
}
