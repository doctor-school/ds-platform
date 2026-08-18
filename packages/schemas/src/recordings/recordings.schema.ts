import { z } from "zod";
import { StreamProviderSchema } from "../events/events.schema.js";
import { TaxonomyErrorCodeSchema } from "../taxonomy/taxonomy.schema.js";

// 014 EARS-1 / EARS-2 (#1339) — the admin contract for retained event recordings
// (014-design §2, §3, §10, §11). API SSOT per ADR-0002 §3: `apps/api` validates at
// the I/O boundary with these schemas and `apps/admin` derives its form resolver
// from the SAME objects, so a bound the server enforces is never re-typed by hand.
//
// The playable source is the EXISTING feature-006 provider abstraction
// (`StreamProviderSchema` + an embed reference) — 014 introduces no second one,
// and no recording is ever a URL column on the event.

/** The two kinds a recording can be (014-design §2). */
export const RECORDING_KINDS = ["edited", "raw"] as const;
export const RecordingKindSchema = z.enum(RECORDING_KINDS);
export type RecordingKind = z.infer<typeof RecordingKindSchema>;

/** The recording's own publication lifecycle (014-design §3). */
export const RECORDING_STATUSES = ["draft", "published", "retired"] as const;
export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

/**
 * The four lifecycle commands of §3. Deliberately named commands rather than a
 * client-supplied target status: `published` is reachable only from `draft` and
 * only while the event is `ended`, and encoding that as "PATCH status" would
 * invite a client to assert a state instead of requesting a transition.
 */
export const RECORDING_COMMANDS = [
  "publish",
  "unpublish",
  "retire",
  "restore",
] as const;
export const RecordingCommandSchema = z.enum(RECORDING_COMMANDS);
export type RecordingCommand = z.infer<typeof RecordingCommandSchema>;

export const EMBED_REF_MAX = 500;
export const POSTER_REF_MAX = 500;
/** 24 hours, matching the `event_recordings_duration_bounds` DB CHECK. */
export const RECORDING_DURATION_SEC_MAX = 24 * 60 * 60;

/** Provider-scoped source id — never a URL to be sniffed (014-design §2). */
export const EmbedRefSchema = z.string().trim().min(1).max(EMBED_REF_MAX);
/** Optional poster reference; an empty string is not a synonym for «none». */
export const PosterRefSchema = z.string().trim().min(1).max(POSTER_REF_MAX);
export const DurationSecSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(RECORDING_DURATION_SEC_MAX);

/** `YYYY-MM-DD` — the plaque promises a day, never an instant (§2). */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const RecordingExpectedBySchema = z
  .string()
  .regex(ISO_DATE_REGEX)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), {
    message: "must be a real calendar date",
  });

/**
 * `AttachRecording` — `POST /v1/admin/events/:id/recordings` (EARS-1). The row is
 * always created in `draft`: attachment and publication are two separate acts, so
 * `status` is server-assigned and never client-supplied.
 */
export const AttachRecordingRequestSchema = z
  .object({
    kind: RecordingKindSchema,
    provider: StreamProviderSchema,
    embedRef: EmbedRefSchema,
    posterRef: PosterRefSchema.nullish(),
    durationSec: DurationSecSchema.nullish(),
  })
  .strict();
export type AttachRecordingRequest = z.infer<
  typeof AttachRecordingRequestSchema
>;

/**
 * `UpdateRecording` — `PATCH /v1/admin/events/:id/recordings/:rid` (EARS-1). A
 * partial with NO defaults: an omitted key leaves the field untouched, while an
 * explicit `null` clears the nullable ones. `kind` is absent on purpose — moving
 * a row between kind slots is not an edit, it is a retire plus a fresh attach,
 * and letting a PATCH do it would slip past the occupied-slot refusal.
 */
export const UpdateRecordingRequestSchema = z
  .object({
    provider: StreamProviderSchema.optional(),
    embedRef: EmbedRefSchema.optional(),
    posterRef: PosterRefSchema.nullish(),
    durationSec: DurationSecSchema.nullish(),
  })
  .strict();
export type UpdateRecordingRequest = z.infer<
  typeof UpdateRecordingRequestSchema
>;

/**
 * The operator's view of one recording row (014-design §7). Source-bearing on
 * purpose: this is the `platform_admin` surface. The public projection
 * (#1340/#1341) is a different, deliberately source-free contract — the login
 * gate of §5 is a response-body fact, not a rendering rule.
 */
export const RecordingAdminDetailSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  kind: RecordingKindSchema,
  provider: StreamProviderSchema,
  embedRef: z.string(),
  posterRef: z.string().nullable(),
  durationSec: z.number().int().nullable(),
  status: RecordingStatusSchema,
  firstPublishedAt: z.iso.datetime({ offset: true }).nullable(),
  deletedAt: z.iso.datetime({ offset: true }).nullable(),
  version: z.number().int(),
  /** The §3 commands legal from this row's current state, right now. */
  validCommands: z.array(RecordingCommandSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type RecordingAdminDetail = z.infer<typeof RecordingAdminDetailSchema>;

/**
 * `GET /v1/admin/events/:id/recordings` — every retained row of the event,
 * retired ones included (they stay addressable, §3), plus the event facts the
 * panel needs to explain what it may and may not do: the lifecycle state that
 * gates publication and the operator's readiness date.
 */
export const RecordingAdminListSchema = z.object({
  data: z.array(RecordingAdminDetailSchema),
  total: z.number().int().nonnegative(),
  /** Publication requires exactly `ended` (§3) — the panel says so up front. */
  eventState: z.string(),
  recordingExpectedBy: z.string().nullable(),
});
export type RecordingAdminList = z.infer<typeof RecordingAdminListSchema>;

/**
 * The §11 subset a recordings client can actually receive. A strict subset of the
 * one shared admin `errorCode` union, not a second union: the shape, the filter
 * and the status table are shared, and this narrows the set for the client.
 */
export const RECORDING_ERROR_CODES = [
  "VALIDATION_FAILED",
  "IDEMPOTENCY_KEY_INVALID",
  "ADMIN_SESSION_REQUIRED",
  "PLATFORM_ADMIN_REQUIRED",
  "RESOURCE_NOT_FOUND",
  "RECORDING_KIND_OCCUPIED",
  "EVENT_NOT_FINISHED",
  "INVALID_TRANSITION",
  "IDEMPOTENCY_KEY_REUSED",
  "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  "PRECONDITION_FAILED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "PRECONDITION_REQUIRED",
] as const;
export const RecordingErrorCodeSchema = z.enum(RECORDING_ERROR_CODES);
export type RecordingErrorCode = z.infer<typeof RecordingErrorCodeSchema>;

// A compile-time proof that the narrowed set stays inside the shared union: a
// code renamed in one place and not the other stops the build here rather than
// at runtime on an operator's screen.
const _recordingCodesAreAdminCodes: readonly z.infer<
  typeof TaxonomyErrorCodeSchema
>[] = RECORDING_ERROR_CODES;
void _recordingCodesAreAdminCodes;

/**
 * The §3 transition table, as data. The service reads THIS rather than a chain of
 * `if`s, so «which commands are legal from here» has exactly one answer and the
 * `validCommands` the panel renders cannot drift from the ones the server honours.
 *
 * `published → published` and every other missing edge is 409 `INVALID_TRANSITION`;
 * the `ended`-event precondition on `publish` is a separate refusal
 * (409 `EVENT_NOT_FINISHED`) because it is a fact about the EVENT, not the edge.
 */
export const RECORDING_TRANSITIONS: Readonly<
  Record<RecordingCommand, { from: readonly RecordingStatus[]; to: RecordingStatus }>
> = {
  publish: { from: ["draft"], to: "published" },
  unpublish: { from: ["published"], to: "draft" },
  retire: { from: ["draft", "published"], to: "retired" },
  restore: { from: ["retired"], to: "draft" },
};

/** The commands legal from `status`, in the panel's display order. */
export function validRecordingCommands(
  status: RecordingStatus,
): RecordingCommand[] {
  return RECORDING_COMMANDS.filter((command) =>
    RECORDING_TRANSITIONS[command].from.includes(status),
  );
}
