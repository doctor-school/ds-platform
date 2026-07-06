"use client";

import { useState } from "react";
import { Container } from "@ds/design-system/container";
import { DayBand } from "@ds/design-system/day-band";
import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { FilterChip } from "@ds/design-system/filter-chip";

/**
 * Layout & spatial rhythm demo (#514). Fidelity SoT: the vendored canvases
 * `design-source/webinar-card.dc.html` (ВебинарКарточка) and
 * `design-source/webinars-listing.dc.html` (Эфиры) — the demo card and the list
 * treatment are rebuilt element-by-element from those two files (issue prose and
 * the previous composition lose to them), on top of the §09 Container/roles:
 *
 *   DESKTOP (≥901, `layout:`): card = 2px ink border + 6px blue `elevation` cast
 *   (`shadow-lg`), 196px time plate (`w-time-plate`) | 1fr body; time 56px/800/
 *   −.04em tabular; ONE-line «Эфир № N»; body 30px 32px; title 24px
 *   (`text-title-lg`); CTAs with their ink (`shadow-btn`) / soft (`shadow-ghost`)
 *   casts; day header = caption label + flex-1 2px ink rule, margin 48px 0 24px
 *   (`layout:mt-section layout:mb-6`); cards gap 28 (`layout:space-y-stack`).
 *
 *   MOBILE (≤900): cards FLAT — border 0, shadow none (CTA shadows none too),
 *   display block, full-bleed (`-mx-4` on the list wrapper), stack 20px
 *   (`space-y-stack-sm` — recorded owner Stage-B decision 2026-07-06, supersedes
 *   the canvas's flush gap:0); the tint time plate turns into a horizontal top
 *   band (padding 14px 16px, time 40px); body 16px 16px 18px, title 20px; the
 *   gray `DayBand` plate (full-bleed, `section` surface) is the MOBILE-only day
 *   header, still FLUSH against its first card (§09 day-band = 0, unchanged).
 *
 * Everything is `@ds/design-system` exports + token-backed utilities (no
 * arbitrary values); the in-page theme toggle flips the `.dark` token cascade so
 * both themes are verifiable on the one live URL.
 */

type Speaker = { name: string; org: string };
type Webinar = {
  variant: "live" | "scheduled";
  num: string;
  time: string;
  timeSub: string;
  school: string;
  title: string;
  chips: string[];
  speakers: Speaker[];
};

/** Day groups — verbatim from webinars-listing.dc.html (week 0, days 16–17). */
const DAYS: { label: string; events: Webinar[] }[] = [
  {
    label: "Сегодня — 16 июля, среда",
    events: [
      {
        variant: "live",
        num: "Эфир № 042",
        time: "19:00",
        timeSub: "идёт 24 мин · 214 смотрят",
        school: "Школа травматологии и ортопедии",
        title: "Пластика ахиллова сухожилия: разбор клинических случаев",
        chips: ["Травматология", "Ортопедия", "Спортивная медицина"],
        speakers: [
          { name: "Анна Соколова", org: "НМИЦ им. Пирогова" },
          { name: "Михаил Верещагин", org: "Сеченовский университет" },
        ],
      },
      {
        variant: "scheduled",
        num: "Эфир № 043",
        time: "20:30",
        timeSub: "сегодня · МСК",
        school: "Школа гастроэнтерологии",
        title: "СИБР и СРК: что нового в 2026 году",
        chips: ["Гастроэнтерология", "Терапия"],
        speakers: [{ name: "Дарья Литвинова", org: "ММА, клиника «Рассвет»" }],
      },
    ],
  },
  {
    label: "Завтра — 17 июля, четверг",
    events: [
      {
        variant: "scheduled",
        num: "Эфир № 044",
        time: "18:00",
        timeSub: "17 июля · МСК",
        school: "Школа кардиологии",
        title: "ХСН с сохранной фракцией выброса: амбулаторное ведение",
        chips: ["Кардиология", "Терапия"],
        speakers: [
          { name: "Пётр Малахов", org: "НМИЦ кардиологии" },
          { name: "Ирина Северова", org: "РНИМУ им. Пирогова" },
        ],
      },
      {
        variant: "scheduled",
        num: "Эфир № 045",
        time: "19:30",
        timeSub: "17 июля · МСК",
        school: "Школа педиатрии",
        title: "Атопический дерматит у детей: ступенчатая терапия",
        chips: ["Педиатрия", "Дерматология"],
        speakers: [{ name: "Ольга Ким", org: "ДГКБ им. Башляевой" }],
      },
    ],
  },
];

const CHIPS = ["Все", "Травматология", "Кардиология", "Педиатрия"] as const;

/**
 * The webinar card, rebuilt from webinar-card.dc.html. Desktop: bordered + blue
 * offset cast, 196px plate | body. Mobile: flat full-bleed block, horizontal tint
 * plate on top, no borders/shadows anywhere (incl. CTAs).
 */
function WebinarCard({ w }: { w: Webinar }) {
  const live = w.variant === "live";
  return (
    <article className="relative block border-0 bg-card text-card-foreground shadow-none layout:flex layout:border-2 layout:border-border layout:shadow-lg">
      {/* Desktop live sticker — rotated red tag riding the top edge (source:
          absolute -16px/22px, rotate(3deg), 12px/800/.12em, 3px cast). */}
      {live ? (
        <Badge
          variant="live"
          className="absolute -top-4 right-5 z-10 hidden rotate-3 px-3.5 py-2 text-xs shadow-sm layout:inline-flex"
        >
          В эфире
        </Badge>
      ) : null}

      {/* Time plate: mobile = horizontal top band (14px 16px); desktop = fixed
          196px left column (30px 24px) with a 2px ink divider. */}
      <div className="flex flex-col gap-2.5 bg-tint px-4 py-3.5 layout:w-time-plate layout:flex-none layout:items-start layout:gap-3 layout:border-r-2 layout:px-6 layout:py-7.5">
        {/* Mobile-only inline live badge (the sticker's ≤900 counterpart). */}
        {live ? (
          <Badge variant="live" className="self-start layout:hidden">
            В эфире
          </Badge>
        ) : null}
        <div className="flex w-full flex-col items-start gap-1 layout:contents">
          <div className="text-3xl font-extrabold leading-none tracking-numeric text-tint-foreground tabular-nums layout:text-4xl">
            {w.time}
          </div>
          <div>
            <div className="whitespace-nowrap text-eyebrow font-extrabold uppercase tracking-micro text-tint-foreground">
              {w.num}
            </div>
            <div className="mt-1 text-xs font-bold uppercase leading-snug tracking-wider text-foreground">
              {w.timeSub}
            </div>
          </div>
        </div>
      </div>

      {/* Body: mobile 16px 16px 18px; desktop 30px 32px. */}
      <div className="min-w-0 flex-1 px-4 pb-4.5 pt-4 layout:px-8 layout:py-7.5">
        <div className="mb-3 text-xs font-extrabold uppercase tracking-micro text-info">
          {w.school}
        </div>
        <a
          href="#"
          className="mb-4.5 block text-lg font-bold leading-tight tracking-tight text-foreground hover:text-info layout:text-title-lg"
        >
          {w.title}
        </a>
        <div className="mb-5.5 flex flex-wrap gap-2">
          {w.chips.map((c) => (
            <span
              key={c}
              className="bg-tint px-3 py-1.5 text-caption font-bold text-foreground"
            >
              {c}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-45 text-caption leading-relaxed text-muted-foreground">
            {w.speakers.map((s, i) => (
              <span key={s.name}>
                <b className="font-bold text-foreground">{s.name}</b>
                {` — ${s.org}`}
                {i < w.speakers.length - 1 ? <br /> : null}
              </span>
            ))}
          </div>
          {/* CTA row (`controls` role, 12px). Solid = ink cast; ghost = soft
              cast; BOTH casts drop on mobile (source: boxShadow m ? none). */}
          <div className="flex flex-wrap gap-controls">
            {live ? (
              <Button className="px-6 py-3.5 shadow-none layout:shadow-btn">
                Войти в эфир ↗
              </Button>
            ) : (
              <>
                <Button className="px-6 py-3.5 shadow-none layout:shadow-btn">
                  Участвовать ↗
                </Button>
                <Button
                  variant="outline"
                  className="px-5 py-3.5 shadow-none layout:shadow-ghost"
                >
                  В календарь
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Day group header, from webinars-listing.dc.html: desktop = caption label +
 * flex-1 2px ink rule (margin 48px 0 24px — the §09 `section` rhythm); mobile =
 * the full-bleed gray `DayBand` plate, FLUSH against the cards (day-band = 0).
 */
function DayHeader({ label }: { label: string }) {
  return (
    <>
      <div className="hidden items-baseline gap-4.5 layout:mb-6 layout:mt-section layout:flex">
        <span className="whitespace-nowrap text-caption font-extrabold uppercase tracking-micro text-foreground">
          {label}
        </span>
        <span className="flex-1 border-t-2 border-border" />
      </div>
      <div className="-mx-4 layout:hidden">
        <DayBand className="px-4">{label}</DayBand>
      </div>
    </>
  );
}

export function RhythmView() {
  const [dark, setDark] = useState(false);
  return (
    <div className={dark ? "dark" : undefined}>
      <div className="min-h-screen bg-background text-foreground">
        {/* Chrome: back + theme toggle. The toggle flips the token cascade so both
            themes are verifiable on the one live URL (Stage-B). */}
        <div className="flex items-center justify-between gap-controls border-b-2 border-border bg-header px-4 py-3 text-header-foreground layout:px-gutter">
          <a href="/" className="text-sm font-bold underline underline-offset-4">
            ← Showcase home
          </a>
          <button
            type="button"
            onClick={() => setDark((v) => !v)}
            className="border-2 border-header-foreground px-3 py-1.5 text-2xs font-extrabold uppercase tracking-micro"
          >
            {dark ? "☀ Светлая тема" : "☾ Тёмная тема"}
          </button>
        </div>

        <Container className="pb-16 pt-inset layout:pb-24">
          <header className="space-y-inline">
            <span className="text-2xs font-extrabold uppercase tracking-micro text-info">
              09 · Раскладка и ритм
            </span>
            <h1 className="text-3xl font-extrabold leading-none tracking-tight">
              Расписание эфиров
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Живая композиция §09 по канвасам «Эфиры» + «ВебинарКарточка»:
              контейнер 1104, брейкпоинт 900, роли inset / stack / section /
              controls / day-band. Сузьте окно ниже 900px — карточки станут
              плоскими и уйдут в край без рамок; переключите тему для обоих
              каскадов токенов.
            </p>
          </header>

          {/* Quick filter chips (the listing's filter row). The mobile bottom
              margin separates the chips from the FIRST day plate; between the
              groups themselves mobile stays FLUSH (canvas: day header margin 0). */}
          <div className="mb-6 mt-6 flex flex-wrap gap-2 layout:mb-0">
            {CHIPS.map((c, i) => (
              <FilterChip key={c} selected={i === 0}>
                {c}
              </FilterChip>
            ))}
          </div>

          {/* Day groups. Desktop rhythm comes from the header's mt-section;
              mobile groups sit FLUSH — the gray day plate is the separator. */}
          {DAYS.map((day) => (
            <section key={day.label}>
              <DayHeader label={day.label} />
              {/* stack role: 20px mobile (`stack-sm` — owner Stage-B decision
                  2026-07-06, supersedes the canvas gap:0) / 28px desktop. */}
              <div className="-mx-4 space-y-stack-sm layout:mx-0 layout:space-y-stack">
                {day.events.map((w) => (
                  <WebinarCard key={w.num} w={w} />
                ))}
              </div>
            </section>
          ))}
        </Container>
      </div>
    </div>
  );
}
