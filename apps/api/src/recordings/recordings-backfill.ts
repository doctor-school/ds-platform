import { randomUUID } from "node:crypto";
import type { INestApplicationContext } from "@nestjs/common";
import { z } from "zod";
import {
  AttachRecordingRequestSchema,
  type AttachRecordingRequest,
  type RecordingKind,
} from "@ds/schemas";
import { auditContextStore } from "../audit/audit-context.js";
import { IdempotencyService } from "../taxonomy/idempotency.service.js";
import { TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import { RecordingsRepository } from "./recordings.repository.js";
import {
  type RecordingCommandResult,
  RecordingsService,
} from "./recordings.service.js";

// 014 EARS-29 (#1892) — the platform-born recording backfill (014-design §3.2).
//
// This module is a DRIVER over the §3 commands and nothing else. It owns no
// state machine, no table, no enum, no error code and no SQL write: every row it
// commits goes through `RecordingsService.attach` + `RecordingsService.transition`
// exactly as the «Записи» tab does, so the LD-1 slot guard, the feature-010 audit
// capture and the §11 error set all apply unchanged. Duration is deliberately
// NOT in the manifest: §7 makes it metadata-derived and never operator-authored,
// so a backfilled row carries `duration_sec = NULL` until EARS-20 (#1611) lands.
// Grep this file for `UPDATE`/`INSERT`: there is none.
//
// Three properties are worth stating out loud, because they are what the spec
// asks for and what the e2e suite proves:
//
// 1. The EVENT is never written. `live_at`, `starts_at`, `state` and `origin`
//    stay exactly as the room recorded them (owner, 2026-09-02: «честные
//    таймстампы»). The driver only READS them, to decide whether a row is
//    eligible at all.
// 2. Every committed write is ATTRIBUTED. Outside HTTP feature 010's interceptor
//    never runs, so a context-less script write degrades to `db-direct`
//    (010 EARS-4). The driver therefore opens the audit ALS scope itself, with
//    the operator's Zitadel `sub` and the door `system:recordings-backfill`.
// 3. A refusal is REPORTED, not fatal. One ineligible row never aborts the run;
//    the operator gets a per-row verdict and re-runs the same manifest.
//
// Scope (owner, 2026-09-05): `origin: platform` эфиры only. The old-platform
// historical import is #1879 and is deliberately refused here.

/** The audit door every write of this driver is attributed to (010 EARS-3). */
export const BACKFILL_AUDIT_SOURCE = "system:recordings-backfill" as const;

/** Idempotency scope — the same one the admin recordings controller reserves under. */
const IDEMPOTENCY_SCOPE = "recordings";

/**
 * One manifest source, in the on-disk snake_case an operator writes by hand.
 * Validation of `provider` × `embed_ref` is NOT re-implemented: the parsed row
 * is handed to feature 014's own {@link AttachRecordingRequestSchema}, which
 * carries feature 006's per-provider embed-ref rules (#1134).
 */
const ManifestSourceSchema = z
  .object({
    provider: z.string(),
    embed_ref: z.string(),
    poster: z.string().nullish(),
  })
  .strict();

const ManifestRowSchema = z
  .object({
    event: z.string().trim().min(1),
    edited: ManifestSourceSchema.optional(),
    raw: ManifestSourceSchema.optional(),
  })
  .strict()
  .refine((row) => row.edited !== undefined || row.raw !== undefined, {
    message: "a manifest row needs at least one of `edited` / `raw`",
  });

const ManifestSchema = z.array(ManifestRowSchema).min(1);

/** One (event, kind) unit of work, its payload already validated by 014's own schema. */
export interface BackfillTarget {
  /** The event id or slug, verbatim as the manifest wrote it. */
  event: string;
  kind: RecordingKind;
  payload: AttachRecordingRequest;
}

export type BackfillManifest = BackfillTarget[];

/**
 * The per-row verdicts of the 014-design §3.2 outcome table.
 *
 * `would-attach` is the DRY-RUN token for «this run would write here» — it
 * covers both the free-slot attach+publish and the publish-only case, because
 * §3.2 fixes the dry-run vocabulary at `would-attach | skipped | refused(<code>)`
 * and the accompanying `detail` names which of the two it is.
 */
export type BackfillOutcome =
  | "attached+published"
  | "published"
  | "skipped"
  | "would-attach"
  | "refused";

export interface BackfillEntry {
  event: string;
  kind: RecordingKind;
  outcome: BackfillOutcome;
  /** The refusal code of the read/command that refused the row, when `outcome` is `refused`. */
  code?: string;
  /** The recording this row resolved to, when one exists or was created. */
  recordingId?: string;
  /** Operator-readable note — the refusal message, or what a dry-run row would do. */
  detail?: string;
}

export interface BackfillReport {
  entries: BackfillEntry[];
  summary: Record<BackfillOutcome, number>;
}

export interface BackfillOptions {
  /** Zitadel `sub` of the operator running the backfill — the audit subject of every write. */
  actorSub: string;
  dryRun?: boolean;
}

/** Exactly the collaborators the driver reads and calls — no more. */
export interface BackfillDeps {
  repo: RecordingsRepository;
  recordings: RecordingsService;
  idempotency: IdempotencyService;
}

/**
 * Resolve the driver's collaborators from a booted Nest context — the entry
 * script's application context, or the e2e suite's testing app. The driver takes
 * the resolved deps rather than the context itself so the suite drives it
 * in-process, with no child process and no HTTP hop.
 */
export function backfillDepsFrom(app: INestApplicationContext): BackfillDeps {
  return {
    repo: app.get(RecordingsRepository),
    recordings: app.get(RecordingsService),
    idempotency: app.get(IdempotencyService),
  };
}

/**
 * Parse and validate a manifest, flattening it into one {@link BackfillTarget}
 * per (row, kind). Throws on the first invalid row — a manifest is validated
 * WHOLE before the run writes anything, so a typo in row 40 never leaves rows
 * 1–39 committed against an operator who would have fixed the file first.
 */
export function parseBackfillManifest(input: unknown): BackfillManifest {
  const rows = ManifestSchema.parse(input);
  return rows.flatMap((row, index) => {
    const kinds: RecordingKind[] = ["edited", "raw"];
    return kinds.flatMap((kind) => {
      const source = row[kind];
      if (!source) return [];
      const parsed = AttachRecordingRequestSchema.safeParse({
        kind,
        provider: source.provider,
        embedRef: source.embed_ref,
        ...(source.poster != null ? { posterRef: source.poster } : {}),
      });
      if (!parsed.success) {
        throw new Error(
          `manifest row ${index + 1} (${row.event}, ${kind}) is invalid: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
        );
      }
      return [{ event: row.event, kind, payload: parsed.data }];
    });
  });
}

/**
 * Run the backfill over a parsed manifest and return the per-row report.
 *
 * The whole run executes inside ONE audit ALS scope, so every mutation the §3
 * commands perform beneath it is captured with the operator's `sub` and the
 * `system:recordings-backfill` door instead of degrading to `db-direct`.
 */
export function runRecordingsBackfill(
  deps: BackfillDeps,
  manifest: BackfillManifest,
  options: BackfillOptions,
): Promise<BackfillReport> {
  return auditContextStore.run(
    { actorSub: options.actorSub, source: BACKFILL_AUDIT_SOURCE },
    async () => {
      const entries: BackfillEntry[] = [];
      for (const target of manifest) {
        entries.push(await runTarget(deps, target, options));
      }
      return { entries, summary: summarize(entries) };
    },
  );
}

function summarize(entries: BackfillEntry[]): Record<BackfillOutcome, number> {
  const summary: Record<BackfillOutcome, number> = {
    "attached+published": 0,
    published: 0,
    skipped: 0,
    "would-attach": 0,
    refused: 0,
  };
  for (const entry of entries) summary[entry.outcome] += 1;
  return summary;
}

async function runTarget(
  deps: BackfillDeps,
  target: BackfillTarget,
  options: BackfillOptions,
): Promise<BackfillEntry> {
  const base = { event: target.event, kind: target.kind };
  // Set once the attach has COMMITTED, so a publish that throws afterwards
  // reports which slot now holds the orphan draft instead of an id-less refusal.
  let committed: string | undefined;
  try {
    // 1. The event read. Unknown id or slug is the ordinary 404 of the existing
    //    read — reported, never invented here.
    const event = await deps.repo.findEventByIdOrSlug(target.event);
    if (!event) {
      return {
        ...base,
        outcome: "refused",
        code: "RESOURCE_NOT_FOUND",
        detail: "no event carries this id or slug",
      };
    }

    // 2. Eligibility, read straight off the event the §3 commands would read.
    //    Both refusals carry the code the command itself would raise, and both
    //    are pre-flighted rather than discovered after the attach: a row that
    //    cannot be published must not be left holding the kind slot as a draft
    //    nobody asked for (§3.2 table, rows 4 and 5).
    if (event.origin !== "platform") {
      return {
        ...base,
        outcome: "refused",
        code: "INVALID_TRANSITION",
        detail: `a ${event.origin} event is out of scope for this backfill (EARS-27; the old-platform import is #1879)`,
      };
    }
    if (event.state !== "ended") {
      return {
        ...base,
        outcome: "refused",
        code: "EVENT_NOT_FINISHED",
        detail: `the backfill attaches recordings to ended эфиры only; this one is ${event.state}`,
      };
    }

    // 3. What the kind slot already holds, read through the ordinary list
    //    command — the LD-1 partial unique index is the guard, this read is what
    //    turns the guard into a per-row verdict.
    const listed = await deps.recordings.list(event.id);
    const held = listed.data.find(
      (row) => row.kind === target.kind && row.status !== "retired",
    );

    if (held?.status === "published") {
      return {
        ...base,
        outcome: "skipped",
        recordingId: held.id,
        detail: "the kind already carries a published recording",
      };
    }

    if (options.dryRun) {
      return {
        ...base,
        outcome: "would-attach",
        ...(held ? { recordingId: held.id } : {}),
        detail: held
          ? "would publish the existing draft (no second row)"
          : "would attach a draft and publish it",
      };
    }

    // 4. The writes — the ordinary commands, nothing else.
    if (held) {
      const published = await publish(
        deps,
        event.id,
        held.id,
        held.version,
        options,
      );
      return {
        ...base,
        outcome: "published",
        recordingId: published.detail.id,
        detail: "the kind carried a non-retired draft; only the publish ran",
      };
    }

    const attached = await deps.recordings.attach({
      eventId: event.id,
      payload: target.payload,
      lease: await lease(deps, options, {
        method: "POST",
        route: "/v1/admin/events/:eventId/recordings",
        path: `/v1/admin/events/${event.id}/recordings`,
        payload: target.payload,
      }),
    });
    committed = attached.detail.id;
    await publish(
      deps,
      event.id,
      attached.detail.id,
      attached.detail.version,
      options,
    );
    return {
      ...base,
      outcome: "attached+published",
      recordingId: attached.detail.id,
    };
  } catch (err) {
    if (err instanceof TaxonomyError) {
      return {
        ...base,
        outcome: "refused",
        code: err.errorCode,
        ...(committed ? { recordingId: committed } : {}),
        ...(err.detail ? { detail: err.detail } : {}),
      };
    }
    throw err;
  }
}

async function publish(
  deps: BackfillDeps,
  eventId: string,
  recordingId: string,
  expectedVersion: number,
  options: BackfillOptions,
): Promise<RecordingCommandResult> {
  const acquired = await lease(deps, options, {
    method: "POST",
    route: "/v1/admin/events/:eventId/recordings/:recordingId/publish",
    path: `/v1/admin/events/${eventId}/recordings/${recordingId}/publish`,
    payload: null,
  });
  return deps.recordings.transition({
    eventId,
    recordingId,
    command: "publish",
    expectedVersion,
    lease: acquired,
  });
}

/**
 * Reserve one idempotency record for one command, the same way the controller
 * does, and hand the service the lease it fences its outcome with.
 *
 * The key is fresh per attempt rather than derived from `(event, kind)`. The
 * re-run guarantee EARS-29 asks for is carried by the LD-1 partial unique index
 * plus the eligibility read above — an already-published kind is `skipped`
 * BEFORE any command is issued. Making the key deterministic instead would fence
 * the SECOND legitimate command of the same slot too: the design's «publish the
 * existing draft» row would replay the first run's stored outcome and silently
 * write nothing. The lease's job here is what it is over HTTP — fencing a single
 * command against a concurrent or crashed attempt — not remembering runs.
 */
async function lease(
  deps: BackfillDeps,
  options: BackfillOptions,
  request: { method: string; route: string; path: string; payload: unknown },
) {
  const outcome = await deps.idempotency.begin({
    key: randomUUID(),
    scope: IDEMPOTENCY_SCOPE,
    actorId: options.actorSub,
    method: request.method,
    route: request.route,
    fingerprint: deps.idempotency.fingerprint({
      method: request.method,
      path: request.path,
      payload: request.payload,
    }),
  });
  if (outcome.kind !== "owned") {
    // Unreachable with a fresh key; a replay here would mean the key space
    // collided, and guessing is exactly what idempotency exists to prevent.
    throw new TaxonomyError(
      "IDEMPOTENCY_REQUEST_IN_PROGRESS",
      "the backfill's idempotency key was already reserved",
    );
  }
  return outcome.lease;
}
