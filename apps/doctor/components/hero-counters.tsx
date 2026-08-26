import {
  SCALE_STATISTICS_COUNTERS,
  type ScaleStatistics,
  type ScaleStatisticsCounter,
} from "@ds/schemas";

/**
 * 017 EARS-2 — the four scale counters of the hero (canvas `d-home · герой`),
 * PRESENTATIONAL and total over 017-design §6 row «Hero + statistics».
 *
 * The state union is the whole point: design §6 names four renders and calls an
 * empty labelled box, a bare zero and an unresolving spinner defects, so the
 * component takes the state as data and has no other way to draw. The fetch that
 * produces that state lives one layer up (`components/scale-counters.tsx`), which
 * keeps THIS file renderable to static markup — the doctor app's unit tier is
 * node-environment, so a presentational split is what makes all four renders
 * assertable without adding a jsdom tier to the app.
 *
 *   `loading`  → skeleton cells, no labels and no numbers (an empty LABELLED box
 *                would claim a counter exists and is zero-ish).
 *   `ready`    → only the counters the read actually carried. An ABSENT key is
 *                omitted with its neighbours still rendering; `0` is a real,
 *                measured zero and renders as one (schema `statistics.schema.ts`).
 *   `error`    → NOTHING. The counters are omitted and the hero copy above them
 *                is untouched — the surface never explains a backend failure to
 *                a doctor, and never paints a number it does not have.
 *
 * `computedAt` reaches the DOM as `data-computed-at` on the grid rather than as
 * on-screen copy: the staleness instant is part of the read contract (LD-3) and
 * must be inspectable, but the canvas hero carries no timestamp line and copy is
 * transcribed from the canvas, not invented here.
 *
 * Grouping is `ru-RU` (canvas «12 400»), which separates thousands with a
 * non-breaking space — the figures are read by Russian-speaking doctors.
 */
export type CountersState =
  | { kind: "loading" }
  | { kind: "ready"; statistics: ScaleStatistics }
  | { kind: "error" };

/** Canvas labels, verbatim, keyed by the contract's own counter order. */
const COUNTER_LABELS: Record<ScaleStatisticsCounter, string> = {
  doctors: "врачей уже с нами",
  specialties: "специальностей",
  lessons: "уроков",
  eventsPerYear: "событий за год",
};

const numberFormat = new Intl.NumberFormat("ru-RU");

/**
 * The band is a WRAPPING FLEX row, not a fixed grid — this is the canvas's
 * `repeat(auto-fit, minmax(180px, 1fr))` mechanism (`doctor-home.dc.html` L62)
 * expressed in tokens-only utilities.
 *
 * It matters because the number of cells is DATA, not layout: production serves
 * three counters today (`lessons` has no source), and a fixed 4-track grid would
 * leave the fourth track empty — the container paints the hairline colour and
 * the gaps let it through, so an empty track becomes a visible pale tile beside
 * «событий за год». `auto-fit` collapses such a track; a wrapping flex row goes
 * one better and has no empty cells to collapse at ANY count or width, because a
 * short last row grows to fill instead of leaving track remainders. `basis-44`
 * (11rem) is the canvas's 180px minimum: below it the cells stack, above it they
 * share the band evenly.
 */
const CELL_BASE = "flex flex-1 basis-44 bg-hero px-4 py-5 layout:px-6 layout:py-6";
/**
 * `flex-col-reverse` so the `dt` (the label) can come FIRST in source — a
 * definition list is term-then-definition, and axe-core's `definition-list` rule
 * evaluates that ordering — while the canvas's visual order (the numeral above
 * its caption) is preserved.
 */
const CELL = `${CELL_BASE} flex-col-reverse`;
const SKELETON_CELL = `${CELL_BASE} flex-col`;
const GRID =
  "mt-10 flex flex-wrap gap-0.5 border-2 border-header-hairline bg-header-hairline";

export function HeroCounters({ state }: { state: CountersState }) {
  if (state.kind === "error") return null;

  if (state.kind === "loading") {
    return (
      <div
        data-testid="hero-counters"
        data-state="loading"
        aria-busy="true"
        aria-label="Загружаем цифры платформы"
        role="status"
        className={GRID}
      >
        {SCALE_STATISTICS_COUNTERS.map((counter) => (
          <div key={counter} className={SKELETON_CELL} aria-hidden="true">
            {/*
              A skeleton bar, not a labelled box with a spinner in it: the cell
              claims nothing until the read resolves. It reserves the band's
              HEIGHT — the bars are sized to the numeral and caption that replace
              them — so the copy below does not move when the read lands. The
              CELL COUNT is the contract's full width and settles to the served
              counters afterwards: how many counters have a source is not
              knowable before the read, and a wrapping band re-flows without ever
              leaving an empty tile behind.
            */}
            <div className="h-10 w-24 animate-pulse bg-header-hairline layout:h-12" />
            <div className="mt-2 h-3 w-32 animate-pulse bg-header-hairline" />
          </div>
        ))}
      </div>
    );
  }

  const present = SCALE_STATISTICS_COUNTERS.filter(
    (counter) => typeof state.statistics[counter] === "number",
  );

  // Every counter absent is the same surface as a failed read: nothing to show,
  // and an empty bordered frame would be the "empty labelled box" §6 forbids.
  if (present.length === 0) return null;

  return (
    <dl
      data-testid="hero-counters"
      data-state="ready"
      data-computed-at={state.statistics.computedAt}
      className={GRID}
    >
      {present.map((counter) => (
        <div
          key={counter}
          data-testid={`hero-counter-${counter}`}
          className={CELL}
        >
          {/* `dt` first in SOURCE, numeral first on SCREEN (`flex-col-reverse`). */}
          <dt className="mt-2 text-xs font-extrabold uppercase tracking-widest text-hero-muted">
            {COUNTER_LABELS[counter]}
          </dt>
          <dd className="text-4xl font-extrabold leading-none tracking-tight tabular-nums text-hero-foreground layout:text-5xl">
            {numberFormat.format(state.statistics[counter] as number)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
