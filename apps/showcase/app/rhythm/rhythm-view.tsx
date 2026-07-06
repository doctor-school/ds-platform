"use client";

import { useState } from "react";
import { Container } from "@ds/design-system/container";
import { DayBand } from "@ds/design-system/day-band";
import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { FilterChip } from "@ds/design-system/filter-chip";

/**
 * Layout & spatial rhythm demo (#514, source §09 «Раскладка и ритм»). A realistic
 * webinar-list composition built ONLY from `@ds/design-system` exports + the §09
 * token-backed spacing-role utilities, exercising every role on one surface:
 *
 *   • Container (`content` / `calendar`) — centred column, `clamp(16,4vw,48)`
 *     desktop gutter, fixed 16px mobile gutter, cap dropped ≤900px (edge-to-edge).
 *   • day-band bleed — `-mx-4 layout:-mx-gutter` pulls the `DayBand` plate flush
 *     to the container edge (the §09 `day-band` role = 0 / bleed).
 *   • stack — `space-y-0 layout:space-y-stack` collapses card gaps to 0 on mobile
 *     (cards butt edge-to-edge) and opens to 28px on desktop.
 *   • section — `space-y-section` (48px) rhythm between the two meaning blocks.
 *   • controls / inline / inset — `gap-controls`, `gap-inline`, `p-inset`.
 *
 * The composition renders full-viewport-width so the ≤900px edge-to-edge collapse
 * is visible on resize; a theme toggle flips the `.dark` token cascade in place so
 * both themes are verifiable on the one live URL (AGENTS.md Stage-B). Token-only.
 */

const CHIPS = ["Кардиология", "Неврология", "Педиатрия"] as const;

function WebinarCard({
  time,
  no,
  title,
  live,
}: {
  time: string;
  no: string;
  title: string;
  live?: boolean;
}) {
  return (
    <article className="flex border-2 border-border bg-card text-card-foreground shadow-lg">
      <div className="flex w-30 flex-none flex-col gap-inline border-r-2 border-border bg-tint p-inset text-tint-foreground">
        <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums">
          {time}
        </span>
        <span className="text-2xs font-extrabold uppercase tracking-micro">
          Эфир № {no}
        </span>
      </div>
      <div className="flex flex-col gap-controls p-inset">
        <div className="flex items-center gap-inline">
          {live ? <Badge variant="live">В эфире</Badge> : null}
          <span className="text-2xs font-extrabold uppercase tracking-micro text-info">
            Вебинар
          </span>
        </div>
        <h3 className="text-lg font-bold leading-snug tracking-tight text-foreground">
          {title}
        </h3>
        <div className="flex flex-wrap gap-controls">
          <Button size="sm">Участвовать</Button>
          <Button size="sm" variant="outline">
            В календарь
          </Button>
        </div>
      </div>
    </article>
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

        <Container className="space-y-section py-inset">
          <header className="space-y-inline">
            <span className="text-2xs font-extrabold uppercase tracking-micro text-info">
              09 · Раскладка и ритм
            </span>
            <h1 className="text-3xl font-extrabold leading-none tracking-tight">
              Layout &amp; spatial rhythm
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Container 1104/1240 · gutter clamp(16→48) · breakpoint 900 · roles
              inset / stack / section / controls / inline / day-band. Resize below
              900px to watch the column go edge-to-edge and the card stack collapse;
              toggle the theme to verify both token cascades.
            </p>
          </header>

          {/* Meaning block 1 — a day of webinars. The day-band bleeds to the
              container edge; the cards stack (0 mobile / 28 desktop). */}
          <section className="space-y-controls">
            <div className="flex flex-wrap gap-controls">
              {CHIPS.map((c, i) => (
                <FilterChip key={c} selected={i === 0}>
                  {c}
                </FilterChip>
              ))}
            </div>
            {/* day-band role = bleed: cancel the Container gutter with -mx. */}
            <div className="-mx-4 layout:-mx-gutter">
              <DayBand>Сегодня — 16 июля</DayBand>
            </div>
            <div className="space-y-0 layout:space-y-stack">
              <WebinarCard
                time="19:00"
                no="042"
                title="Артериальная гипертензия: разбор клинических случаев"
                live
              />
              <WebinarCard
                time="20:30"
                no="043"
                title="Диагностика ранней сердечной недостаточности"
              />
            </div>
          </section>

          {/* Meaning block 2 — separated from block 1 by the `section` role (48px),
              proving the block rhythm reads as a distinct meaning group. */}
          <section className="space-y-controls">
            <div className="-mx-4 layout:-mx-gutter">
              <DayBand>Завтра — 17 июля</DayBand>
            </div>
            <div className="space-y-0 layout:space-y-stack">
              <WebinarCard
                time="18:00"
                no="044"
                title="Педиатрическая неврология: судорожные состояния"
              />
            </div>
          </section>
        </Container>
      </div>
    </div>
  );
}
