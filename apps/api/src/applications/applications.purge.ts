import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { ApplicationsService } from "./applications.service.js";

/**
 * 033 EARS-20, EARS-23 — the queue's daily retention pass (precedent
 * `sign-in-host-record.purge.ts`). Two steps, in order: close every open
 * application with no status change for a year as `expired` (EARS-23), then
 * erase every application closed for a year to the tombstone (EARS-20).
 *
 * It runs once shortly after boot and then every 24 hours: the api restarts on
 * every release, so an interval alone could be reset before it ever fires.
 * Both steps are idempotent conditional updates, so overlapping passes on
 * several api instances do no harm.
 */
@Injectable()
export class ApplicationsPurge implements OnModuleInit, OnModuleDestroy {
  static readonly INTERVAL_NAME = "applications-retention-purge";
  static readonly TIMEOUT_NAME = "applications-retention-purge-boot";
  static readonly INTERVAL_MS = 24 * 60 * 60 * 1000;
  static readonly BOOT_DELAY_MS = 60 * 1000;

  private readonly logger = new Logger(ApplicationsPurge.name);
  private running = false;

  constructor(
    @Inject(ApplicationsService)
    private readonly applications: ApplicationsService,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    this.clear();
    const boot = setTimeout(() => {
      void this.runOnce();
    }, ApplicationsPurge.BOOT_DELAY_MS);
    boot.unref();
    this.registry.addTimeout(ApplicationsPurge.TIMEOUT_NAME, boot);
    const handle = setInterval(() => {
      void this.runOnce();
    }, ApplicationsPurge.INTERVAL_MS);
    handle.unref();
    this.registry.addInterval(ApplicationsPurge.INTERVAL_NAME, handle);
  }

  onModuleDestroy(): void {
    this.clear();
  }

  /** One pass; returns how many applications it expired and erased. */
  async runOnce(): Promise<{ expired: number; erased: number }> {
    if (this.running) return { expired: 0, erased: 0 };
    this.running = true;
    try {
      const expired = await this.applications.expireStale();
      const erased = await this.applications.eraseClosedDue();
      if (expired > 0 || erased > 0)
        this.logger.log(
          `applications purge: expired ${expired}, erased ${erased}`,
        );
      return { expired, erased };
    } catch (e) {
      this.logger.error(`applications purge failed: ${(e as Error).message}`);
      return { expired: 0, erased: 0 };
    } finally {
      this.running = false;
    }
  }

  private clear(): void {
    if (this.registry.getIntervals().includes(ApplicationsPurge.INTERVAL_NAME))
      this.registry.deleteInterval(ApplicationsPurge.INTERVAL_NAME);
    if (this.registry.getTimeouts().includes(ApplicationsPurge.TIMEOUT_NAME))
      this.registry.deleteTimeout(ApplicationsPurge.TIMEOUT_NAME);
  }
}
