import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { IDP_CLIENT, type IdpClient } from "../auth/idp/idp.types.js";
import type { SignInHostSettings } from "./sign-in-host.config.js";
import { SignInHostRecordStore } from "./sign-in-host-record.store.js";
import {
  SIGN_IN_HOST_CLOCK,
  SIGN_IN_HOST_SETTINGS,
  type SignInHostClock,
} from "./sign-in-host.tokens.js";

/**
 * 003 EARS-64 — the retention of `sign_in_host_records`, decided with the table:
 * every hour, rows past their 30-day end or their 7-day idle are deleted and
 * their Zitadel sessions terminated (best-effort; Zitadel ends a session at its
 * own lifetime regardless). A row a request meets first is handled on that
 * request; this purge bounds what no browser returns for. Idempotent across
 * API instances. Off while the module is disabled.
 */
@Injectable()
export class SignInHostRecordPurge implements OnModuleInit, OnModuleDestroy {
  static readonly INTERVAL_NAME = "sign-in-host-record-purge";
  static readonly INTERVAL_MS = 60 * 60 * 1000;

  private readonly logger = new Logger(SignInHostRecordPurge.name);
  private running = false;

  constructor(
    @Inject(SIGN_IN_HOST_SETTINGS)
    private readonly settings: SignInHostSettings | null,
    @Inject(SignInHostRecordStore)
    private readonly records: SignInHostRecordStore,
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(SIGN_IN_HOST_CLOCK) private readonly clock: SignInHostClock,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.settings) return;
    this.clear();
    const handle = setInterval(() => {
      void this.runOnce();
    }, SignInHostRecordPurge.INTERVAL_MS);
    handle.unref();
    this.registry.addInterval(SignInHostRecordPurge.INTERVAL_NAME, handle);
  }

  onModuleDestroy(): void {
    this.clear();
  }

  /** One purge pass; returns how many rows it removed. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const sessions = await this.records.purgeExpired(this.clock());
      for (const session of sessions) await this.idp.terminateSession(session);
      return sessions.length;
    } catch (e) {
      this.logger.error(
        `sign-in-host record purge failed: ${(e as Error).message}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private clear(): void {
    if (
      this.registry.getIntervals().includes(SignInHostRecordPurge.INTERVAL_NAME)
    ) {
      this.registry.deleteInterval(SignInHostRecordPurge.INTERVAL_NAME);
    }
  }
}
