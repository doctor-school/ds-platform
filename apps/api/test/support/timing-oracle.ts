/**
 * Test-only timing oracle for the EARS-16 / §7 "≤ 50 ms" response-timing bands.
 *
 * A single wall-clock sample per class is dominated by one-off scheduler / GC /
 * lazy-init spikes on shared CI runners (#2591): one isolated request lands
 * 80–110 ms while every other pair sits flat at ~41 ms. Sampling every class
 * several times, INTERLEAVED round-robin so drift hits all classes equally,
 * and comparing MEDIANS keeps the oracle sensitive to a real per-branch delta
 * (which shifts every sample of a class) while ignoring a lone outlier.
 */

export const DEFAULT_TIMING_ROUNDS = 5;

/** One measured class: its raw samples (ms), their median, and each result. */
export interface TimingClass<T> {
  samples: number[];
  median: number;
  results: T[];
}

export interface SampleInterleavedOptions {
  /** Measured rounds per class (each round visits every class once). ≥ 5. */
  rounds?: number;
  /** Run one discarded warm-up round first (round index 0). */
  warmup?: boolean;
}

/** Median of a non-empty list (mean of the two middle values when even). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Times every class once per round, round-robin (A, B, C, A, B, C, …).
 * Each class callback receives the round index: 0 is the warm-up round when
 * `warmup` is on, measured rounds follow. Warm-up samples are discarded.
 */
export async function sampleInterleaved<T>(
  classes: ReadonlyArray<(round: number) => Promise<T>>,
  {
    rounds = DEFAULT_TIMING_ROUNDS,
    warmup = true,
  }: SampleInterleavedOptions = {},
): Promise<TimingClass<T>[]> {
  if (rounds < DEFAULT_TIMING_ROUNDS)
    throw new Error(`timing oracle needs ≥ ${DEFAULT_TIMING_ROUNDS} rounds`);
  const out = classes.map(() => ({
    samples: [] as number[],
    results: [] as T[],
  }));
  const first = warmup ? 0 : 1;
  for (let round = first; round <= rounds; round++) {
    for (const [index, run] of classes.entries()) {
      const started = performance.now();
      const result = await run(round);
      const ms = performance.now() - started;
      if (round === 0) continue;
      out[index]!.samples.push(ms);
      out[index]!.results.push(result);
    }
  }
  return out.map((c) => ({ ...c, median: median(c.samples) }));
}

/** Spread of the class medians (max − min) — the value the band bounds. */
export function medianSpread(classes: readonly TimingClass<unknown>[]): number {
  const medians = classes.map((c) => c.median);
  return Math.max(...medians) - Math.min(...medians);
}

/** Diagnostic line: medians plus raw samples, e.g. `41.2 [40.9 41.2 …]`. */
export function describeTiming(
  classes: readonly TimingClass<unknown>[],
): string {
  return classes
    .map(
      (c) =>
        `${c.median.toFixed(1)} [${c.samples.map((s) => s.toFixed(1)).join(" ")}]`,
    )
    .join(" / ");
}
