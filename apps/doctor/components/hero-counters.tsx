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

const CELL = "bg-hero px-4 py-5 layout:px-6 layout:py-6";
const GRID =
  "mt-10 grid grid-cols-1 gap-0.5 border-2 border-header-hairline bg-header-hairline sm:grid-cols-2 layout:grid-cols-4";

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
          <div key={counter} className={CELL} aria-hidden="true">
            {/*
              A skeleton bar, not a labelled box with a spinner in it: the cell
              claims nothing until the read resolves. Sized to the numeral and
              the caption it will be replaced by, so the hero does not jump.
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
        <div key={counter} data-testid={`hero-counter-${counter}`} className={CELL}>
          <dd className="text-4xl font-extrabold leading-none tracking-tight tabular-nums text-hero-foreground layout:text-5xl">
            {numberFormat.format(state.statistics[counter] as number)}
          </dd>
          <dt className="mt-2 text-xs font-extrabold uppercase tracking-widest text-hero-muted">
            {COUNTER_LABELS[counter]}
          </dt>
        </div>
      ))}
    </dl>
  );
}
