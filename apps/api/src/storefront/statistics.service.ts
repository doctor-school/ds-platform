import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  buildScaleStatistics,
  type ScaleStatistics,
  type ScaleStatisticsCounter,
} from "@ds/schemas";
import { SpecialtiesService } from "./specialties.service.js";
import { StatisticsRepository } from "./statistics.repository.js";

// 017 EARS-2 / LD-3 (#1480) — the scale-statistics projection.
//
// ## What LD-3 fixes, and what it leaves to this file
//
// FIXED by the spec: one read serves already-computed figures with a bounded
// staleness window; no counter is operator-typed; no counter is computed by
// counting rows on the read path; a counter whose source is unavailable is
// omitted while its neighbours still render.
//
// LEFT to this file: HOW the projection refreshes. LD-3 says so explicitly, so
// replacing the mechanism below (with a materialized view, a scheduled job, a
// shared cache) is an implementation change, not a spec change — nothing about
// the wire contract encodes it.
//
// ## The mechanism chosen here
//
// An in-process snapshot with a TTL, recomputed OFF the request path:
//
//   * a background timer refreshes every `REFRESH_INTERVAL_MS`;
//   * a request is served from the snapshot and never triggers a count;
//   * while the snapshot is older than `MAX_STALENESS_MS` it is still served,
//     and a refresh is kicked off asynchronously — a slow database degrades
//     freshness, never the latency of the home page;
//   * the ONE case that awaits a computation is the very first request before
//     any refresh has completed (cold start), and it is single-flighted so a
//     burst of first visitors produces one set of queries, not one per visitor.
//
// In-process is the right scope for this figure: it is public, identical for
// every viewer, and cheap to recompute, so per-replica snapshots that differ by
// at most one staleness window are indistinguishable to a doctor — and it adds
// no cross-service dependency to a page that must render when Redis is down.
//
// ## Per-counter failure, not all-or-nothing
//
// Each counter has its OWN source resolver and each is settled independently:
// a failing or absent source omits that counter and leaves the others intact.
// That is what makes 017-design §6's «a counter with no source is omitted, not
// zeroed» a structural property here rather than a rule to remember — the
// refresh cannot produce a placeholder zero, because a source that did not
// return a number contributes no key at all.

/** How often the background refresh recomputes the snapshot. */
const REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * The bounded staleness window LD-3 requires. Larger than the refresh interval
 * so an ordinary refresh keeps the snapshot inside it; crossing it means
 * refreshes are failing, and the response then still carries the honest older
 * `computedAt` rather than a fresh-looking timestamp over stale figures.
 */
const MAX_STALENESS_MS = 15 * 60_000;

/** A source that could not produce a figure contributes `undefined`. */
type CounterSources = Record<
  ScaleStatisticsCounter,
  () => Promise<number | undefined>
>;

@Injectable()
export class StatisticsService implements OnModuleDestroy {
  private readonly logger = new Logger(StatisticsService.name);

  /** The computed snapshot. `null` until the first refresh completes. */
  private snapshot: ScaleStatistics | null = null;
  private snapshotAt = 0;

  /** The in-flight refresh, if any — the single-flight latch. */
  private refreshing: Promise<void> | null = null;

  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(StatisticsRepository)
    private readonly statistics: StatisticsRepository,
    @Inject(SpecialtiesService)
    private readonly specialties: SpecialtiesService,
  ) {}

  /**
   * The per-counter sources.
   *
   * `lessons` is deliberately absent: the platform has no lesson table yet, so
   * there is NO source for that counter and it is omitted from every response.
   * It is not stubbed with a zero, a literal or a placeholder — a number a
   * doctor could read as "there are no lessons" would be a false statement,
   * whereas an omitted counter is honestly silent. The obligation to give it a
   * source lands with the feature that owns lessons; adding one here is a
   * one-line change with no contract impact.
   */
  private readonly sources: Partial<CounterSources> = {
    doctors: () => this.statistics.countDoctors(),
    // The specialty counter binds to the size of the book the specialty read
    // actually serves (`SpecialtyBook.total`, 017-design §7) — never a second
    // count of `specialties_minzdrav` and never a literal, so the hero and the
    // catalog's «Показать весь список — N» can never disagree.
    specialties: async () => (await this.specialties.book()).total,
    eventsPerYear: () => this.statistics.countEventsPerYear(),
  };

  /** Start the background refresh loop. Called by the module on boot. */
  start(): void {
    if (this.timer) return;
    // `unref` so a pending refresh never holds the process (or a test runner)
    // open, and the loop is torn down explicitly in `onModuleDestroy`.
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
    this.timer.unref?.();
    // Warm the snapshot immediately so the first visitor is served from cache.
    void this.refresh();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * The read LD-3 describes: already-computed figures plus `computedAt`.
   *
   * Serves the snapshot. Awaits a computation only on a cold start; a merely
   * stale snapshot is served as-is with a refresh kicked off behind it.
   */
  async read(): Promise<ScaleStatistics> {
    const age = Date.now() - this.snapshotAt;
    if (!this.snapshot) {
      await this.refresh();
    } else if (age > MAX_STALENESS_MS) {
      void this.refresh();
    }
    // After a cold refresh whose sources all failed, the snapshot exists and
    // simply carries no counters — hero copy renders, counters are omitted
    // (017-design §6, the «ошибка» column).
    return this.snapshot ?? buildScaleStatistics({}, new Date());
  }

  /**
   * Recompute the snapshot. Single-flighted: concurrent callers await the same
   * pass rather than each issuing its own aggregates.
   */
  async refresh(): Promise<void> {
    this.refreshing ??= this.compute().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  private async compute(): Promise<void> {
    const entries = Object.entries(this.sources) as [
      ScaleStatisticsCounter,
      () => Promise<number | undefined>,
    ][];

    const settled = await Promise.allSettled(
      entries.map(([, resolve]) => resolve()),
    );

    const counters: Partial<Record<ScaleStatisticsCounter, number>> = {};
    settled.forEach((result, index) => {
      const key = entries[index]![0];
      if (result.status === "fulfilled") {
        if (typeof result.value === "number") counters[key] = result.value;
        return;
      }
      // One unavailable source omits ONE counter. It is logged rather than
      // rethrown: the hero must keep rendering its remaining figures.
      this.logger.warn(
        `scale statistics: source «${key}» unavailable — counter omitted`,
        result.reason instanceof Error
          ? result.reason.stack
          : String(result.reason),
      );
    });

    const computedAt = new Date();
    this.snapshot = buildScaleStatistics(counters, computedAt);
    this.snapshotAt = computedAt.getTime();
  }
}
