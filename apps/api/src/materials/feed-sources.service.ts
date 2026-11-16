import { Inject, Injectable } from "@nestjs/common";
import type { FeedSource } from "@ds/db";
import {
  type CreateFeedSourceRequest,
  FEED_SOURCE_ADDRESS_TAKEN_ERROR,
  type FeedSourceAdmin,
  type FeedSourceAdminList,
  type FeedSourceNetwork,
  taxonomyETag,
  type UpdateFeedSourceRequest,
} from "@ds/schemas";
import {
  type IdempotencyLease,
  IdempotencyService,
  markReplayable,
  TaxonomyError,
} from "../taxonomy/index.js";
import {
  FeedSourcesRepository,
  type FeedSourcesTx,
} from "./feed-sources.repository.js";
import { TelegramSourceCheck } from "./telegram/telegram-source-check.service.js";

/** How long an admin write's response waits for the at-once check (EARS-21). */
export const AT_ONCE_CHECK_BUDGET_MS = 15_000;

// 048 slice 2 (#3993) — the «Источники» commands (EARS-20…EARS-23). Same
// failure ORDER and shared services as the material commands: guard → key
// shape → fingerprint binding → one audit-attributed transaction (row lock →
// precondition → validation → write → entry marks → fenced record
// completion). A refused write changes nothing.
//
// EARS-21 — add, address edit and switch-on run the source check of EARS-31
// at once (#3994): AFTER the command's transaction commits — a Bot API call
// never holds the row lock, and a failed or unreachable check never fails the
// administrator's write (the stored source shows the check's reason). The
// response waits for the check up to `AT_ONCE_CHECK_BUDGET_MS`, so it already
// carries the checked status; past that bound it carries the committed state
// and the check still writes its verdict when Telegram answers. An exact
// idempotent replay returns the response recorded at commit (before the
// check); the list read is always current.

export interface CreateFeedSourceInput {
  payload: CreateFeedSourceRequest;
  lease: IdempotencyLease;
}

export interface UpdateFeedSourceInput {
  id: string;
  payload: UpdateFeedSourceRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface FeedSourceSwitchInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface FeedSourceCommandResult {
  detail: FeedSourceAdmin;
  etag: string;
}

const STALE = "the source changed since it was read; reload and retry";

@Injectable()
export class FeedSourcesService {
  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(FeedSourcesRepository)
    private readonly repo: FeedSourcesRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(TelegramSourceCheck)
    private readonly sourceCheck: TelegramSourceCheck,
  ) {}

  /** EARS-20 — `GET /v1/admin/feed-sources`. */
  async list(): Promise<FeedSourceAdminList> {
    const rows = await this.repo.list();
    return {
      data: rows.map(({ source, entryCount }) => toAdmin(source, entryCount)),
    };
  }

  async create(input: CreateFeedSourceInput): Promise<FeedSourceCommandResult> {
    const result = await this.fenced(input.lease, () =>
      this.repo.transaction(async (tx) => {
        const { platform, address } = input.payload;
        await this.assertAddressFree(tx, platform, address, null);
        const created = await this.repo.insert(tx, { platform, address });
        return this.complete(tx, input.lease, created, 201);
      }),
    );
    return this.checkAtOnce(result);
  }

  /**
   * EARS-21 — «Изменить адрес». A changed address rewrites the `href` of each
   * entry in the same transaction and returns the source to «Не проверен»:
   * the last check judged the old address.
   */
  async update(input: UpdateFeedSourceInput): Promise<FeedSourceCommandResult> {
    const result = await this.fenced(input.lease, () =>
      this.repo.transaction(async (tx) => {
        const current = await this.lockVersion(
          tx,
          input.id,
          input.expectedVersion,
        );
        const platform = network(current);
        const { address } = input.payload;
        const changed = address !== current.address;
        if (changed) {
          await this.assertAddressFree(tx, platform, address, current.id);
        }
        const moved = await this.repo.updateVersioned(
          tx,
          current.id,
          input.expectedVersion,
          changed
            ? {
                address,
                status: "unchecked",
                statusReason: null,
                checkedAt: null,
              }
            : {},
        );
        if (!moved) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
        if (changed) await this.repo.rewriteHrefs(tx, moved.id, address);
        return this.complete(tx, input.lease, moved, 200);
      }),
    );
    return this.checkAtOnce(result);
  }

  /** EARS-22 — «Выключить»: the source and each of its entries, one transaction. */
  disable(input: FeedSourceSwitchInput): Promise<FeedSourceCommandResult> {
    return this.switchTo(input, false);
  }

  /** EARS-22 — «Включить»: the marks cleared, kept entries return at their dates. */
  async enable(input: FeedSourceSwitchInput): Promise<FeedSourceCommandResult> {
    return this.checkAtOnce(await this.switchTo(input, true));
  }

  /**
   * EARS-21 — the at-once EARS-31 check of a committed write, bounded by
   * {@link AT_ONCE_CHECK_BUDGET_MS}. The check writes no `version`, so the
   * ETag of the committed write stays valid.
   */
  private async checkAtOnce(
    result: FeedSourceCommandResult,
  ): Promise<FeedSourceCommandResult> {
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), AT_ONCE_CHECK_BUDGET_MS);
    });
    const checked = await Promise.race([
      this.sourceCheck.check(result.detail.id),
      bound,
    ]).finally(() => clearTimeout(timer));
    if (!checked) return result;
    return {
      etag: result.etag,
      detail: {
        ...result.detail,
        status: checked.status,
        statusReason: checked.statusReason,
        checkedAt: checked.checkedAt?.toISOString() ?? null,
      },
    };
  }

  private switchTo(
    input: FeedSourceSwitchInput,
    enabled: boolean,
  ): Promise<FeedSourceCommandResult> {
    return this.fenced(input.lease, () =>
      this.repo.transaction(async (tx) => {
        const current = await this.lockVersion(
          tx,
          input.id,
          input.expectedVersion,
        );
        if (current.enabled === enabled) {
          throw new TaxonomyError(
            "INVALID_TRANSITION",
            enabled
              ? "this source is already switched on"
              : "this source is already switched off",
          );
        }
        const moved = await this.repo.updateVersioned(
          tx,
          current.id,
          input.expectedVersion,
          { enabled },
        );
        if (!moved) throw new TaxonomyError("PRECONDITION_FAILED", STALE);
        await this.repo.markEntries(tx, moved.id, !enabled);
        return this.complete(tx, input.lease, moved, 200);
      }),
    );
  }

  /** Tag a deterministic refusal with its record, so an exact retry replays it. */
  private async fenced<T>(
    lease: IdempotencyLease,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw markReplayable(err, lease);
    }
  }

  /** EARS-21 — an address already listed for the platform is a field error. */
  private async assertAddressFree(
    tx: FeedSourcesTx,
    platform: FeedSourceNetwork,
    address: string,
    exceptId: string | null,
  ): Promise<void> {
    await this.repo.lockAddress(tx, platform, address);
    if (await this.repo.addressTaken(tx, platform, address, exceptId)) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "the address is already listed for this platform",
        [{ path: "address", message: FEED_SOURCE_ADDRESS_TAKEN_ERROR }],
      );
    }
  }

  /** Lock the row and assert the caller's version (412 when it moved). */
  private async lockVersion(
    tx: FeedSourcesTx,
    id: string,
    expectedVersion: number,
  ): Promise<FeedSource> {
    const row = await this.repo.lockById(tx, id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (row.version !== expectedVersion) {
      throw new TaxonomyError("PRECONDITION_FAILED", STALE);
    }
    return row;
  }

  /** Complete the idempotency record in the command's transaction. */
  private async complete(
    tx: FeedSourcesTx,
    lease: IdempotencyLease,
    row: FeedSource,
    status: 200 | 201,
  ): Promise<FeedSourceCommandResult> {
    const detail = toAdmin(row, await this.repo.entryCount(tx, row.id));
    const etag = taxonomyETag(row.version);
    await this.idempotency.complete(tx, lease, {
      status,
      body: detail,
      etag,
      ...(status === 201
        ? { location: `/v1/admin/feed-sources/${row.id}` }
        : {}),
    });
    return { detail, etag };
  }
}

/** A stored source is a network one (CHECK `feed_sources_network_platform`). */
function network(row: FeedSource): FeedSourceNetwork {
  if (row.platform === "academy") {
    throw new Error(`feed source ${row.id} names the own-materials platform`);
  }
  return row.platform;
}

function toAdmin(row: FeedSource, entryCount: number): FeedSourceAdmin {
  return {
    id: row.id,
    platform: network(row),
    address: row.address,
    enabled: row.enabled,
    status: row.status,
    statusReason: row.statusReason,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    entryCount,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
