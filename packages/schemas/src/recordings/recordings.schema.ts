import { z } from "zod";
import {
  EmbedRefSchema,
  MSK_LOCAL_DATETIME,
  RecordingExpectedBySchema,
  refineEmbedRefForProvider,
  SpeakerEntrySchema,
  StreamProviderSchema,
} from "../events/events.schema.js";
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

export const POSTER_REF_MAX = 500;
/** 24 hours, matching the `event_recordings_duration_bounds` DB CHECK. */
export const RECORDING_DURATION_SEC_MAX = 24 * 60 * 60;

// The playable source is validated by feature 006's EXISTING pair — the shared
// `EmbedRefSchema` bounds plus `refineEmbedRefForProvider` (the per-provider id
// shapes and the URL-paste ban, #1134). 014 adds no second embed validator: a
// recording's source is the same kind of provider-scoped reference the live room
// already stores, so "is this a valid rutube id" keeps exactly one answer.

/** Optional poster reference; an empty string is not a synonym for «none». */
export const PosterRefSchema = z.string().trim().min(1).max(POSTER_REF_MAX);
export const DurationSecSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(RECORDING_DURATION_SEC_MAX);

// `recordingExpectedBy` is a column on the EVENT, not on `event_recordings`, so
// `RecordingExpectedBySchema` / `ISO_DATE_REGEX` live in `events.schema.ts`, next
// to the `UpdateEventRequestSchema` field they validate. They are NOT re-exported
// here: this file already imports the event contracts, so a re-export would make
// the two `export *` barrels declare the same names twice (ESM drops ambiguous
// star exports silently) — one home per symbol.

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
  .strict()
  .superRefine((value, ctx) => {
    refineEmbedRefForProvider(ctx, value.provider, value.embedRef);
  });
export type AttachRecordingRequest = z.infer<
  typeof AttachRecordingRequestSchema
>;

/**
 * `CreateLegacyBroadcast` — `POST /v1/admin/legacy-broadcasts` (014 EARS-24).
 * The «Архивный эфир» creation entry: one `legacy` event authored from a title,
 * a held-at instant, a duration, speakers and a recording, born `hidden`.
 *
 * It lives HERE and not in `events.schema.ts` for the same reason the note above
 * gives for `RecordingExpectedBySchema`: one home per symbol, and this body
 * embeds {@link AttachRecordingRequestSchema}. The import direction is
 * recordings → events and never back, so putting it on the events side would
 * make the two `export *` barrels cycle.
 *
 * `state` and `origin` are ABSENT on purpose — both are server-assigned
 * (`hidden` / `legacy`), never client-supplied, exactly as `CreateEvent` never
 * lets a caller author `draft`. `.strict()` is what turns a hopeful
 * `{ origin: "platform" }` into a 400 at the I/O boundary rather than a silently
 * ignored key.
 *
 * The recording rides the SAME request rather than a follow-up call: 014-design
 * §3.1 defines the эфир as existing to carry its recording, and a create that
 * could succeed without one would leave an event that can never be archived —
 * the untracked seam AGENTS.md §6 (F-22) forbids. It lands in `draft` like every
 * other attached recording; publishing it is the separate act that makes
 * «Архивировать» legal (EARS-25).
 */
export const LegacyBroadcastCreateBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    /**
     * Series / school kicker, as on `CreateEvent`. OPTIONAL here and defaulting
     * to `""`: 014-design §3.1 names five inputs for an архивный эфир and this
     * is not among them, because an эфир that predates the platform frequently
     * predates the series taxonomy too. `""` is the truthful «no kicker», not a
     * placeholder — the storefront card renders no source line for it.
     */
    school: z.string().trim().max(200).default(""),
    /**
     * The instant the эфир was ACTUALLY held, entered as МСК wall-clock
     * (`YYYY-MM-DDTHH:mm`) and folded into the same canonical UTC instant
     * `startsAt` carries for a platform broadcast. Named `heldAt` rather than
     * `startsAt` because it is a historical fact, not a schedule — nothing is
     * going to start.
     */
    heldAtMsk: z.string().regex(MSK_LOCAL_DATETIME),
    durationMin: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 60),
    description: z.string().trim().max(20_000).default(""),
    /** Ordered free-text speakers, the same LD-1 shape `CreateEvent` takes. */
    speakers: z.array(SpeakerEntrySchema).max(50).default([]),
    specialties: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    /** The recording the эфир exists to carry — created `draft` (EARS-24). */
    recording: AttachRecordingRequestSchema,
  })
  .strict();
export type LegacyBroadcastCreateBody = z.infer<
  typeof LegacyBroadcastCreateBodySchema
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
  .strict()
  .superRefine((value, ctx) => {
    // The source is one value in two fields: an `embedRef` is only meaningful
    // against the provider whose id format it must match, so a correction
    // carries BOTH or neither. Patching one alone would let a rutube id be
    // re-labelled `youtube` without ever being re-validated.
    const partial =
      (value.provider === undefined) !== (value.embedRef === undefined);
    if (partial) {
      ctx.addIssue({
        code: "custom",
        path: [value.provider === undefined ? "provider" : "embedRef"],
      });
      return;
    }
    if (value.provider !== undefined && value.embedRef !== undefined) {
      refineEmbedRefForProvider(ctx, value.provider, value.embedRef);
    }
  });
export type UpdateRecordingRequest = z.infer<
  typeof UpdateRecordingRequestSchema
>;

/**
 * 014 EARS-3 (#1340) — the three states the public projection can be in
 * (014-design §4). Not a status: `montage` / `raw-only` / `preparing` describe
 * what the VISITOR is offered, derived on every read from the published,
 * non-retired rows alone. `montage` covers both «edited + raw» and «edited
 * only» — from the visitor's side those render the same primary player, and the
 * presence of a second cut is carried by `secondaryKind`, not by a fourth state.
 */
export const RECORDING_STATES = ["montage", "raw-only", "preparing"] as const;
export const RecordingStateSchema = z.enum(RECORDING_STATES);
export type RecordingState = z.infer<typeof RecordingStateSchema>;

/**
 * `RecordingProjection` — the SOURCE-FREE public read model of 014-design §4,
 * shared verbatim by all four consumers (#1341 public page, #1344 playback,
 * #1346 «Мои события», #1347 archive badge). It answers «what does this event
 * offer» and deliberately carries no `provider` / `embedRef`: the playable
 * source lives behind the authenticated `PlayableRecording` contract, so the §5
 * login gate is a response-body fact rather than a rendering rule.
 *
 * The edited-over-raw rule is derived, never stored: there is no `is_primary`,
 * `is_featured` or ordering column on `event_recordings`, and publishing the
 * edited cut later promotes it with no operator edit at all.
 */
export const RecordingProjectionSchema = z.object({
  state: RecordingStateSchema,
  /** The cut the player would load. `null` exactly when `preparing`. */
  primaryKind: RecordingKindSchema.nullable(),
  /** The alternative cut, `raw` under a montage; `null` when there is none. */
  secondaryKind: RecordingKindSchema.nullable(),
  /**
   * The primary cut's `event_recordings.poster_ref`; `null` renders the provider
   * still. Despite the contract name, this is a bounded PROVIDER-SCOPED REFERENCE,
   * not an absolute URL: 014 stores no media bytes and never fetches what the
   * reference points at (module README property 4). A consumer resolves it into a
   * src through the same provider mapping it already uses for `embedRef` — putting
   * this value straight into `<img src>` is the bug this sentence exists to stop.
   * Validated by the package's own `PosterRefSchema`, so an empty string can never
   * reach a consumer as if it were a poster.
   */
  posterUrl: PosterRefSchema.nullable(),
  /**
   * `events.recording_expected_by` — the DAY the plaque promises, as `YYYY-MM-DD`.
   * Carried only while `preparing`: once something is published the promise has
   * been kept and repeating it would contradict the player on the same page.
   * Validated by the SAME `RecordingExpectedBySchema` the write side uses, so a
   * malformed or non-existent day cannot leave through the read model either.
   */
  expectedBy: RecordingExpectedBySchema.nullable(),
});
export type RecordingProjection = z.infer<typeof RecordingProjectionSchema>;

/**
 * 014 EARS-5 (#1343) — ONE playable cut, as the authenticated read hands it out
 * (014-design §5). This is the counterpart the `RecordingProjection` docblock
 * above points at: the projection answers «what does this event offer», and this
 * contract answers «what do I load», and only ever behind the login gate.
 *
 * It carries the source and nothing administrative: no id, no `status`, no
 * `version`, no `firstPublishedAt`. A doctor needs the provider and the embed
 * reference to mount a player; handing them the row's lifecycle would be a
 * second, accidental admin surface reachable with a plain doctor session.
 *
 * `embedRef` stays a PROVIDER-SCOPED REFERENCE, never a URL (#1134): the consumer
 * resolves it through the same 006 provider mapping it already uses for the live
 * room, so there is one place that knows what a rutube id becomes.
 */
export const PlayableRecordingSchema = z.object({
  kind: RecordingKindSchema,
  provider: StreamProviderSchema,
  embedRef: z.string(),
  posterRef: PosterRefSchema.nullable(),
  durationSec: z.number().int().nullable(),
});
export type PlayableRecording = z.infer<typeof PlayableRecordingSchema>;

/**
 * `GET /v1/events/:idOrSlug/recordings` — the whole authenticated playback body.
 *
 * The two slots mirror the EARS-3 projection exactly: `primary` is the cut the
 * player loads (edited over raw), `secondary` is the raw capture under a montage
 * and `null` otherwise. Both are `null` for a `preparing` event, and that is a
 * **200, not an error** (014-design §5): the plaque is a legitimate answer to
 * «what can I watch», and a 404 there would make an honest empty state look like
 * a broken link. The event's own 404 is a different fact and keeps its status.
 */
export const EventPlaybackSchema = z.object({
  primary: PlayableRecordingSchema.nullable(),
  secondary: PlayableRecordingSchema.nullable(),
});
export type EventPlayback = z.infer<typeof EventPlaybackSchema>;

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
  Record<
    RecordingCommand,
    { from: readonly RecordingStatus[]; to: RecordingStatus }
  >
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
