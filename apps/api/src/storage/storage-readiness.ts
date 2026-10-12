import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { CheckStatus } from "@ds/schemas";
import type { ObjectStorage, StorageProbeResult } from "./storage.types.js";
import { OBJECT_STORAGE } from "./storage.types.js";

/** Refresh period of the cached object-storage probe (002 EARS-3). */
export const STORAGE_READINESS_INTERVAL_MS = 60_000;
/** A probe still unanswered after this long counts as down (002 EARS-3). */
export const STORAGE_PROBE_TIMEOUT_MS = 10_000;

/** DI token for the refresh period (a value, so tests and the module agree on one source). */
export const STORAGE_READINESS_INTERVAL = Symbol("STORAGE_READINESS_INTERVAL");
/** Optional DI token for log sinks (tests); production logs through Nest's Logger. */
export const STORAGE_READINESS_SINKS = Symbol("STORAGE_READINESS_SINKS");

export interface StorageReadinessSinks {
  warn?: (line: string) => void;
  log?: (line: string) => void;
}

/**
 * Cached object-storage readiness (002 EARS-3, #2821). Probes the bound
 * {@link ObjectStorage} at startup and every {@link STORAGE_READINESS_INTERVAL_MS},
 * holds the latest result, and logs only on a state transition: a WARN with the
 * readable reason when the store goes down, a LOG when it recovers. `GET
 * /v1/ready` reads {@link status} — it never calls the store per request (the
 * endpoint is public), and the reason stays in the logs, never in the body.
 *
 * Overlap guard: a tick that fires while a probe is still in flight is skipped
 * (mirrors `ReconcileScheduler`); a hung probe resolves down after
 * {@link STORAGE_PROBE_TIMEOUT_MS} and its request is aborted, so neither the
 * guard nor the transport can wedge.
 */
@Injectable()
export class ObjectStorageReadiness implements OnModuleInit, OnModuleDestroy {
  static readonly INTERVAL_NAME = "object-storage-readiness";
  private static readonly logger = new Logger("ObjectStorageReadiness");

  /** Not ready until a probe has proven otherwise. */
  private current: CheckStatus = "down";
  private probed = false;
  private running = false;
  private readonly warn: (line: string) => void;
  private readonly log: (line: string) => void;

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(STORAGE_READINESS_INTERVAL) private readonly intervalMs: number,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Optional()
    @Inject(STORAGE_READINESS_SINKS)
    sinks: StorageReadinessSinks | undefined = {},
  ) {
    const out = sinks ?? {};
    this.warn =
      out.warn ?? ((line) => ObjectStorageReadiness.logger.warn(line));
    this.log = out.log ?? ((line) => ObjectStorageReadiness.logger.log(line));
  }

  /** The latest cached state — no I/O. */
  status(): CheckStatus {
    return this.current;
  }

  async onModuleInit(): Promise<void> {
    await this.runOnce();
    this.clearInterval();
    const handle = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.registry.addInterval(ObjectStorageReadiness.INTERVAL_NAME, handle);
  }

  onModuleDestroy(): void {
    this.clearInterval();
  }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.record(await this.probeWithTimeout());
    } finally {
      this.running = false;
    }
  }

  private async probeWithTimeout(): Promise<StorageProbeResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const timeout = new Promise<StorageProbeResult>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve({
          ok: false,
          reason: `probe timed out after ${STORAGE_PROBE_TIMEOUT_MS}ms`,
        });
      }, STORAGE_PROBE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        this.storage.probe(abort.signal).catch((err: unknown): StorageProbeResult => ({
          ok: false,
          reason: err instanceof Error ? err.name : "probe failed",
        })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private record(result: StorageProbeResult): void {
    const previous = this.probed ? this.current : null;
    const next: CheckStatus = result.ok ? "ok" : "down";
    this.probed = true;
    this.current = next;
    if (previous === next) return;
    if (!result.ok) this.warn(`object storage is down: ${result.reason}`);
    else if (previous === "down") this.log("object storage recovered");
    else this.log("object storage is ready");
  }

  private clearInterval(): void {
    if (
      this.registry
        .getIntervals()
        .includes(ObjectStorageReadiness.INTERVAL_NAME)
    ) {
      this.registry.deleteInterval(ObjectStorageReadiness.INTERVAL_NAME);
    }
  }
}
