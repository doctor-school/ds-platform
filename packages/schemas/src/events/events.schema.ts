import { z } from "zod";

// 007 — Event-admin aggregate contracts (API SSOT, ADR-0002 §3, ADR-0006 §6.2).
// Framework-agnostic; `apps/api` wraps these with `createZodDto` at the I/O
// boundary and the Refine admin app (apps/admin) + the 004/005/006 consumers
// share the same types. This file covers the EARS-1 create surface (the write
// model 004/005/006 read projections of) plus the shared lifecycle vocabulary.

/**
 * The single event-lifecycle state machine (007 requirements EARS-7, design §2).
 * One closed enum replacing the legacy boolean scatter — the source of truth
 * every 004/005/006 surface reads. The forward transition set is the SSOT
 * {@link LIFECYCLE_TRANSITIONS}; EARS-1 authors only the `draft` entry state,
 * the transition commands + server-side guard are sibling handlers (EARS-4…7).
 */
export const EVENT_LIFECYCLE_STATES = [
  "draft",
  "published",
  "live",
  "ended",
  "archived",
] as const;
export const EventLifecycleStateSchema = z.enum(EVENT_LIFECYCLE_STATES);
export type EventLifecycleState = z.infer<typeof EventLifecycleStateSchema>;

/**
 * The closed forward transition set (design §2). The ONLY legal moves are the
 * four forward transitions; every other move is refused server-side (EARS-7).
 * Kept here as the shared SSOT so the admin UI derives its offered actions
 * (`EventAdminDetail.validTransitions`) and the EARS-7 guard enforces refusal
 * from the same map — there is no second source to drift.
 */
export const LIFECYCLE_TRANSITIONS: Record<
  EventLifecycleState,
  readonly EventLifecycleState[]
> = {
  draft: ["published"],
  published: ["live"],
  live: ["ended"],
  ended: ["archived"],
  archived: [],
};

/** The transitions valid from `state` (the admin surface offers only these). */
export function validTransitions(
  state: EventLifecycleState,
): EventLifecycleState[] {
  return [...LIFECYCLE_TRANSITIONS[state]];
}

/**
 * The closed-set guard predicate (EARS-7). `true` iff moving `from → to` is one
 * of the four legal forward transitions. Every other move — a skip-forward, any
 * backward move, reopening `archived`, the `published → draft` unpublish the PRD
 * names none, and any self-transition — is `false`. This is the single predicate
 * the server-side guard and the read-side `validTransitions` derive from, so the
 * admin UI (which offers only valid moves) and the API refusal can never drift.
 */
export function canTransition(
  from: EventLifecycleState,
  to: EventLifecycleState,
): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * The `TransitionEvent` command body (EARS-7). Carries only the target state,
 * constrained to the closed lifecycle enum — a target outside the enum is a
 * validation error (400) at the I/O boundary, before the guard runs; an
 * in-enum-but-out-of-order target is the guard's own refusal (a 4xx state
 * conflict). The transition is server-assigned through the guard, never a raw
 * client-supplied state write.
 */
export const TransitionEventRequestSchema = z.object({
  to: EventLifecycleStateSchema,
});
export type TransitionEventRequest = z.infer<
  typeof TransitionEventRequestSchema
>;

/**
 * Canonical Moscow-time handling (EARS-1, EARS-10, design §3). The operator
 * enters a date + time understood as **МСК**; the system stores ONE canonical
 * UTC instant. Moscow is permanently UTC+3 (Russia abolished seasonal DST in
 * 2014), so the offset is a fixed constant — no tz database lookup is needed to
 * fold a МСК wall-clock into an instant.
 */
export const MSK_UTC_OFFSET = "+03:00";

/** A naive МСК wall-clock datetime — `YYYY-MM-DDTHH:mm`, no offset (the operator's local entry). */
export const MSK_LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Fold a naive МСК wall-clock string into the canonical UTC instant. Pure + the
 * single SSOT for the МСК→instant conversion, so the API write path and any
 * consumer agree byte-for-byte. Throws on a malformed input (callers validate
 * with {@link MSK_LOCAL_DATETIME} first).
 */
export function mskLocalToInstant(local: string): Date {
  if (!MSK_LOCAL_DATETIME.test(local)) {
    throw new RangeError(`not a МСК wall-clock datetime: ${local}`);
  }
  const instant = new Date(`${local}:00${MSK_UTC_OFFSET}`);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`invalid МСК datetime: ${local}`);
  }
  return instant;
}

/**
 * The closed stream-provider enum (007 requirements EARS-3, design §3). The
 * provider is chosen **explicitly** by the operator — it is NEVER inferred by
 * sniffing the embed URL (the legacy mistake, recon §5). The 006 room switches
 * on this value to instantiate the right player. The set is
 * `rutube | youtube | vk | cdnvideo` — all RU-reachable, embeddable providers;
 * extending it further is an additive migration (rutube/youtube per the 006 owner
 * decision 2026-07-06; vk/cdnvideo added #1134), never a URL-sniffed inference.
 * This is the shared SSOT the API, the Refine admin app, the DB `stream_provider`
 * enum, and the 006 consumer all read.
 */
export const STREAM_PROVIDERS = ["rutube", "youtube", "vk", "cdnvideo"] as const;
export const StreamProviderSchema = z.enum(STREAM_PROVIDERS);
export type StreamProvider = z.infer<typeof StreamProviderSchema>;

/**
 * A value that LOOKS LIKE a URL — a scheme separator (`://`), a leading
 * `http(s):`, or a leading `www.`. An `embedRef` must be a provider-scoped stream
 * id, never a URL to be sniffed (EARS-3, the legacy mistake recon §5), so the SSOT
 * rejects a URL-shaped value at the boundary — the server AND the admin form (which
 * derives its client validation from this schema) agree, and a wrong "paste the
 * whole share link" entry is refused rather than silently persisted for the 006
 * room to choke on.
 */
export const EMBED_REF_LOOKS_LIKE_URL = /:\/\/|^\s*(?:https?:|www\.)/i;

/**
 * The `embedRef` **base** field validator (EARS-3) — a bounded, trimmed token,
 * 1–300 chars. The single SSOT the api DTO and the admin client resolver both read
 * for the field-level bounds, so the two can never drift.
 *
 * The URL-shape rejection is deliberately NOT baked here: it is
 * **provider-scoped** and enforced in {@link ConfigureStreamRequestSchema}'s
 * cross-field refinement instead. For the id-style providers (`rutube`, `youtube`,
 * `vk`) a URL-shaped paste is the legacy "paste the whole share link" mistake and
 * is refused; for `cdnvideo` the embedRef IS the provisioned player URL
 * (host-allowlisted), so a field-level URL ban would wrongly reject the only valid
 * value. Keeping the URL guard in the provider-aware superRefine is what lets both
 * hold from one SSOT (#1134).
 */
// NB: deliberately NO baked `message` — a zod v4 schema-level message outranks a
// consumer's per-parse error map, which would leak English into the admin form's
// RU rendering (the 003 precedent, #200). Consumers key on the `custom` issue code
// + `embedRef` path instead.
export const EmbedRefSchema = z.string().trim().min(1).max(300);

/**
 * Per-provider embed-id shapes (EARS-3, #665 Stage-B). The provider's REAL id
 * format, researched from the providers' own embed contracts — not an invented
 * pattern — so a keyboard-mash token (the Stage-B repro `ччсапп`) is refused at
 * the SSOT boundary instead of persisting a reference the 006 player cannot embed:
 *
 * - `youtube` — the 11-character video id, alphabet `[A-Za-z0-9_-]` (the id in
 *   `youtu.be/<id>`, `watch?v=<id>`, `/live/<id>`; live streams carry a regular
 *   video id). Length and alphabet per YouTube's modified-base64 id scheme.
 * - `rutube` — the 32-character lowercase-hex video id (the id in
 *   `rutube.ru/video/<id>/` and `rutube.ru/play/embed/<id>`, per Rutube's own
 *   embed FAQ, rutube.ru/info/embed). Ids are machine-copied from the URL, so
 *   the canonical lowercase is required — an uppercase variant is not a valid
 *   Rutube path segment.
 * - `vk` — the `oid_id_hash` triple (#1134). VK's embed identity is irreducible:
 *   `oid` (owner id, **negative for a community**), `id` (video id), and `hash`
 *   (a mandatory, server-minted, **non-derivable** access token from VK's export
 *   dialog — a bare oid/id cannot embed). This stays an opaque id, not a URL, so
 *   the no-URL-sniffing invariant (006-design §3) holds unchanged for vk: the
 *   portal re-composes `video_ext.php?oid&id&hash` from the triple.
 * - `cdnvideo` — the **stored-URL exception** (#1134). CDNVideo provisions a whole
 *   hosted Aloha-player page per stream and hands the customer that URL; there is
 *   NO bare stream id to store. So `embedRef` for cdnvideo IS the full player URL,
 *   and its "shape" is a strict **https + host + path allowlist** pinned to
 *   `playercdn.cdnvideo.ru/aloha/players/` (covering both provisioned forms —
 *   `iframe_<client>_<stream>_player.html` and `auto_playerN.html?clid&plid`).
 *   The allowlist is the **SSRF guard**: because the value flows straight into the
 *   006 room's `<iframe src>`, pinning the origin means a mis-authored 007 config
 *   can never point the frame at an arbitrary host (006-design §3, inline).
 *
 * Extending {@link STREAM_PROVIDERS} later MUST add the new provider's shape here
 * (the `satisfies` clause makes a missing entry a compile error).
 */
export const EMBED_REF_SHAPES = {
  rutube: /^[0-9a-f]{32}$/,
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vk: /^-?\d+_\d+_[0-9a-f]{16,}$/,
  cdnvideo:
    /^https:\/\/playercdn\.cdnvideo\.ru\/aloha\/players\/[A-Za-z0-9_.\-/]+\.html(\?[A-Za-z0-9_.\-/=&%]*)?$/,
} as const satisfies Record<StreamProvider, RegExp>;

/**
 * `ConfigureStream` request body (EARS-3). Records `{ provider, embedRef }`: the
 * provider is an explicit member of the closed enum (an out-of-enum value is a
 * 400 at the I/O boundary, before any handler runs, so no config is recorded for
 * an unknown provider); `embedRef` is the **provider-scoped stream reference**
 * ({@link EmbedRefSchema} bounds) that must match the chosen provider's real shape
 * ({@link EMBED_REF_SHAPES}) — never a free token. For the id-style providers
 * (`rutube`, `youtube`, `vk`) it is an opaque id and a URL-shaped paste is refused
 * (the legacy sniff mistake); `cdnvideo` is the recorded stored-URL exception —
 * its reference IS the host-allowlisted player URL. Configuring is an idempotent
 * upsert (one config per event); it is correctable while the event is `published`
 * (US-3), so a wrong reference is fixed with an edit, never a state reversal.
 */
// NB: the cross-field checks live on the OBJECT (the URL ban + shape both depend
// on the chosen provider) and stay silent while either field is still invalid on
// its own — each problem renders exactly one issue. As with EmbedRefSchema, NO
// baked `message` (#200); consumers key on `custom` + `embedRef` path. The URL ban
// emits an UNTAGGED issue (the admin resolver's "paste a link" copy); the shape
// mismatch carries `params.shape` (the provider), which picks the provider-named
// RU copy.
export const ConfigureStreamRequestSchema = z
  .object({
    provider: StreamProviderSchema,
    embedRef: EmbedRefSchema,
  })
  .superRefine((value, ctx) => {
    if (!StreamProviderSchema.safeParse(value.provider).success) return;
    if (!EmbedRefSchema.safeParse(value.embedRef).success) return;
    // Id-style providers reject a URL-shaped paste up front with the actionable
    // "you pasted a link" copy; `cdnvideo`'s reference IS a URL (validated by its
    // allowlist shape below), so it is exempt from this guard (#1134).
    if (
      value.provider !== "cdnvideo" &&
      EMBED_REF_LOOKS_LIKE_URL.test(value.embedRef)
    ) {
      ctx.addIssue({ code: "custom", path: ["embedRef"] });
      return;
    }
    if (!EMBED_REF_SHAPES[value.provider].test(value.embedRef)) {
      ctx.addIssue({
        code: "custom",
        path: ["embedRef"],
        params: { shape: value.provider },
      });
    }
  });
export type ConfigureStreamRequest = z.infer<
  typeof ConfigureStreamRequestSchema
>;

/**
 * `StreamConfig` — the produced read model the 006 room consumes to instantiate
 * the player (design §3, §Read models). It is exactly `{ provider, embedRef }`;
 * the room switches on `provider` (never parsing the URL) and embeds `embedRef`.
 * Surfaced on {@link EventAdminDetailSchema} (`null` until configured) and read
 * by 006 over the same aggregate — one source, no drift.
 */
export const StreamConfigSchema = z.object({
  provider: StreamProviderSchema,
  embedRef: z.string(),
});
export type StreamConfig = z.infer<typeof StreamConfigSchema>;

/**
 * A speaker entry — an ordered free-text `{ name, regalia }` pair (LD-1). Wave 1
 * validates text only; real-record references are wave 2 (bundled with the
 * speaker directory). The array order IS the presentation order (position).
 */
export const SpeakerEntrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  regalia: z.string().trim().max(500).default(""),
});
export type SpeakerEntry = z.infer<typeof SpeakerEntrySchema>;

/**
 * `CreateEvent` request (EARS-1). The program PDF binary is NOT in this JSON —
 * it rides the same multipart request as the `programPdf` file part and is
 * uploaded to object storage; the stored reference lands on the aggregate. A
 * new event is always created in `draft` (the state is server-assigned, never
 * client-supplied).
 */
export const CreateEventRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  /** School / series kicker. */
  school: z.string().trim().min(1).max(200),
  /** Date + time entered as МСК wall-clock (`YYYY-MM-DDTHH:mm`); stored as one
   * canonical instant. NO baked `message` — it would outrank a consumer's
   * per-parse error map and leak English into the admin RU rendering (#200). */
  startsAtMsk: z.string().regex(MSK_LOCAL_DATETIME),
  durationMin: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60),
  description: z.string().trim().max(20_000).default(""),
  /** Ordered free-text speakers (LD-1). */
  speakers: z.array(SpeakerEntrySchema).max(50).default([]),
  /** Target specialty codes. */
  specialties: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  /** Sponsor / partner reference (free text in wave 1). */
  partnerRef: z.string().trim().max(300).nullish(),
});
export type CreateEventRequest = z.infer<typeof CreateEventRequestSchema>;

/**
 * `UpdateEvent` request (EARS-2). The edit form's JSON field — a **partial** of
 * the authored aggregate: every field is optional and carries **no default**, so
 * an omitted key leaves that field untouched (a `.partial()` of the create schema
 * would re-apply create's `""`/`[]` defaults and silently blank an omitted field
 * — the wrong semantics for an edit). A present key overwrites; `partnerRef:
 * null` explicitly clears the reference (nullish), while an omitted `partnerRef`
 * leaves it. The program-PDF **binary** is not in this JSON — like create it
 * rides the same multipart request as the `programPdf` file part, and a present
 * replacement supersedes the stored object reference (the 004 page then serves
 * the current file). The lifecycle `state` is **never** client-supplied here — an
 * edit is not a state reversal (there is no unpublish, EARS-7); state moves only
 * through the guarded transition commands. Editing is a **pre-archive** action;
 * the server refuses an edit to an `archived` event (EARS-2, requirements Scope).
 */
export const UpdateEventRequestSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  school: z.string().trim().min(1).max(200).optional(),
  /** Date + time re-entered as МСК wall-clock (`YYYY-MM-DDTHH:mm`); re-folded
   * into one canonical instant. NO baked `message` (see create schema note). */
  startsAtMsk: z.string().regex(MSK_LOCAL_DATETIME).optional(),
  durationMin: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .optional(),
  description: z.string().trim().max(20_000).optional(),
  /** Ordered free-text speakers (LD-1); a present list replaces the stored list wholesale. */
  speakers: z.array(SpeakerEntrySchema).max(50).optional(),
  specialties: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  /** `null` clears the sponsor/partner reference; an omitted key leaves it. */
  partnerRef: z.string().trim().max(300).nullish(),
});
export type UpdateEventRequest = z.infer<typeof UpdateEventRequestSchema>;

/**
 * The full editable aggregate for one event (`EventAdminDetail` read model,
 * design §Read models). `platform_admin`-authenticated; never public. Datetimes
 * are ISO-8601 UTC strings (the canonical instant); the admin surface renders
 * them back in МСК (EARS-10). `programPdfUrl` is a resolvable object-storage URL
 * for the current file; `null` when no PDF is attached.
 */
export const EventAdminDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int(),
  description: z.string(),
  speakers: z.array(SpeakerEntrySchema),
  specialties: z.array(z.string()),
  partnerRef: z.string().nullable(),
  programPdfRef: z.string().nullable(),
  programPdfUrl: z.string().nullable(),
  /** The stream config the 006 room consumes (EARS-3); `null` until configured. */
  streamConfig: StreamConfigSchema.nullable(),
  state: EventLifecycleStateSchema,
  validTransitions: z.array(EventLifecycleStateSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type EventAdminDetail = z.infer<typeof EventAdminDetailSchema>;

/** One row of the operator's `EventAdminList` (all states). `platform_admin`-only. */
export const EventAdminListItemSchema = EventAdminDetailSchema.pick({
  id: true,
  slug: true,
  title: true,
  school: true,
  startsAt: true,
  durationMin: true,
  state: true,
  validTransitions: true,
});
export type EventAdminListItem = z.infer<typeof EventAdminListItemSchema>;

export const EventAdminListSchema = z.object({
  data: z.array(EventAdminListItemSchema),
  total: z.number().int().nonnegative(),
});
export type EventAdminList = z.infer<typeof EventAdminListSchema>;

// ── 004 — public read side (PublicEventPage projection) ──────────────────────
// The publish-safe projections the 004 public (unauthenticated) query endpoints
// return. These are consumed read-only over the 007 write model; 004 owns no
// write path (004 design §3, requirements EARS-1/EARS-10).

/**
 * The public event-page lifecycle states — the subset of
 * {@link EVENT_LIFECYCLE_STATES} the public read surface may render. `draft` is
 * deliberately EXCLUDED: a draft event has no public projection (a request for
 * one is not-found, EARS-6), so `draft` can never appear on a `PublicEventPage`
 * body. `archived` is present — an archived direct link resolves to a public
 * notice body (EARS-5), never a 404.
 */
export const PUBLIC_EVENT_STATES = [
  "published",
  "live",
  "ended",
  "archived",
] as const;
export const PublicEventStateSchema = z.enum(PUBLIC_EVENT_STATES);
export type PublicEventState = z.infer<typeof PublicEventStateSchema>;

/**
 * The EARS-6 event-page reachability predicate — the single SSOT the public
 * visibility policy reads. `true` iff a public event-page request for an event in
 * `state` resolves to a body, i.e. `state` is one of the publicly-renderable
 * {@link PUBLIC_EVENT_STATES} (`published`/`live`/`ended`/`archived`). `draft` is
 * the sole non-reachable state: its page is not-found, indistinguishable from a
 * non-existent id, so a hidden draft leaks no "exists but private" oracle (004
 * design §2). Derived from the same allow-list the {@link PublicEventState}
 * projection type is — an allow-list, not a blocklist — so any future non-public
 * state added to the machine is not-found BY DEFAULT and can never leak (this is
 * the structural half of EARS-6/EARS-10, mirroring the projection's allow-list
 * posture, not a `state === 'draft'` denylist that a new state would slip past).
 */
export function isPubliclyReachable(state: EventLifecycleState): boolean {
  return (PUBLIC_EVENT_STATES as readonly EventLifecycleState[]).includes(
    state,
  );
}

/**
 * A publish-safe speaker entry (004 design §3) — display `name` + `credentials`
 * only. The internal write model's free-text `regalia` is projected to
 * `credentials`; no contact detail or other PII is ever exposed (EARS-10).
 */
export const PublicSpeakerSchema = z.object({
  name: z.string(),
  credentials: z.string(),
});
export type PublicSpeaker = z.infer<typeof PublicSpeakerSchema>;

/**
 * A backing partner as shown publicly — a display `label` only. No commercial
 * terms, sponsor contract data, or operator notes cross onto the public body
 * (EARS-10).
 */
export const PublicPartnerSchema = z.object({
  label: z.string(),
});
export type PublicPartner = z.infer<typeof PublicPartnerSchema>;

/**
 * `PublicEventPage` — the publish-safe projection returned by
 * `GET /v1/public/events/:idOrSlug` (004 design §3, EARS-1). It is an
 * ALLOW-LIST, not a redactor: only the fields named here are ever exposed, so a
 * new internal column stays invisible to the public API until it is explicitly
 * added to this projection (the structural guard behind EARS-10 — the recon §6
 * `getEmailsForOrder` roster can never touch a public surface). It carries NO
 * operator/commercial field (the raw partner ref, the program storage key, the
 * row timestamps, the admin `validTransitions`) and NO registrant PII.
 *
 * `startsAt` is the canonical UTC instant (ISO-8601); every surface renders it
 * in `Europe/Moscow` labeled МСК (EARS-12). `programPdfUrl` is OMITTED (not
 * null) when the event has no program PDF — the page renders the program section
 * without a download affordance rather than a broken link (EARS-2).
 */
export const PublicEventPageSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int(),
  description: z.string(),
  speakers: z.array(PublicSpeakerSchema),
  specialties: z.array(z.string()),
  partners: z.array(PublicPartnerSchema),
  programPdfUrl: z.string().optional(),
  state: PublicEventStateSchema,
});
export type PublicEventPage = z.infer<typeof PublicEventPageSchema>;

/**
 * The two lifecycle states an event may carry on the upcoming listing (004
 * design §3, §4, EARS-7). Only a `published` or a currently-airing `live` event
 * is listed — `ended`/`archived` drop from the listing (EARS-9) and `draft` is
 * never public. A card whose event has left these two states is dropped on the
 * next read, so the card's `state` is a closed two-value subset, not the full
 * public-page enum.
 */
export const UPCOMING_BROADCAST_STATES = ["published", "live"] as const;
export const UpcomingBroadcastStateSchema = z.enum(UPCOMING_BROADCAST_STATES);
export type UpcomingBroadcastState = z.infer<
  typeof UpcomingBroadcastStateSchema
>;

/**
 * A card speaker (004 design §3) — display `name` only. The listing card's
 * choose-set is deliberately thinner than the event page's: no `credentials`, no
 * contact detail, no PII. The write model's `regalia` is not projected onto the
 * card at all.
 */
export const UpcomingBroadcastSpeakerSchema = z.object({
  name: z.string(),
});
export type UpcomingBroadcastSpeaker = z.infer<
  typeof UpcomingBroadcastSpeakerSchema
>;

/**
 * `UpcomingBroadcastCard` — the publish-safe projection returned by
 * `GET /v1/public/events?upcoming` (004 design §3, §4, EARS-7). A THINNER
 * allow-list than {@link PublicEventPageSchema}: only the card choose-set (EARS-8)
 * — `id, slug, title, school, startsAt, specialties[], speakers[]{name}, state` —
 * with **no** description, partners, program PDF, duration, or any
 * operator/commercial field or registrant PII (the structural half of EARS-10).
 * Like the event-page projection it is an allow-list, not a redactor: a new
 * internal column stays invisible on the card until explicitly added here.
 *
 * `startsAt` is the canonical UTC instant (ISO-8601); every surface renders it in
 * `Europe/Moscow` labeled МСК (EARS-12). Cards are returned ordered nearest air
 * date first (`starts_at ASC`); an empty result is a valid `[]` (EARS-11).
 */
export const UpcomingBroadcastCardSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  specialties: z.array(z.string()),
  speakers: z.array(UpcomingBroadcastSpeakerSchema),
  state: UpcomingBroadcastStateSchema,
});
export type UpcomingBroadcastCard = z.infer<typeof UpcomingBroadcastCardSchema>;

/** The listing endpoint returns a bare array (an empty result is a valid `[]`, EARS-11). */
export const UpcomingBroadcastListSchema = z.array(UpcomingBroadcastCardSchema);
export type UpcomingBroadcastList = z.infer<typeof UpcomingBroadcastListSchema>;

// ── 004 wave-2 — month-calendar read side (MonthBroadcastEntry / MonthlyEventCount) ──
// The publish-safe projections the month view + its 12-month picker read (004
// requirements EARS-15/EARS-16, design §3/§4). Consumed read-only over the 007
// write model, same allow-list discipline as the wave-1 public projections.

/**
 * The lifecycle states an event may carry on the month grid (004 design §3,
 * EARS-15). The closed publish-VISIBLE subset `published`/`live`/`ended` — the
 * month view INCLUDES the month's already-past `ended` events (rendered as muted
 * aggregate notes), which is why `ended` is present here where the upcoming
 * card's {@link UPCOMING_BROADCAST_STATES} drops it. `draft` and `archived` are
 * deliberately absent: they have NO month projection (structurally, not by a
 * denylist), so a new non-visible state can never leak onto the grid.
 */
export const MONTH_BROADCAST_STATES = ["published", "live", "ended"] as const;
export const MonthBroadcastStateSchema = z.enum(MONTH_BROADCAST_STATES);
export type MonthBroadcastState = z.infer<typeof MonthBroadcastStateSchema>;

/**
 * `MonthBroadcastEntry` — the month-grid projection returned by
 * `GET /v1/public/events?month=YYYY-MM` (004 design §3, EARS-15). A THIN
 * allow-list like {@link UpcomingBroadcastCardSchema}: exactly
 * `id, slug, title, school, startsAt, state` — NO description, partners, program
 * PDF, duration, speakers, or any operator/commercial field or registrant PII
 * (the structural half of EARS-10). Like the sibling projections it is an
 * allow-list, not a redactor: a new internal column stays invisible on the entry
 * until explicitly added here.
 *
 * `startsAt` is the canonical UTC instant (ISO-8601); every surface renders it in
 * `Europe/Moscow` labeled МСК (EARS-12). Entries are returned ordered nearest
 * air date first (`starts_at ASC`); an empty month is a valid `200 []`.
 */
export const MonthBroadcastEntrySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  school: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  state: MonthBroadcastStateSchema,
});
export type MonthBroadcastEntry = z.infer<typeof MonthBroadcastEntrySchema>;

/** The month read returns a bare array (an empty month is a valid `[]`, EARS-15). */
export const MonthBroadcastListSchema = z.array(MonthBroadcastEntrySchema);
export type MonthBroadcastList = z.infer<typeof MonthBroadcastListSchema>;

/**
 * `MonthlyEventCount` — one row of the month-picker projection returned by
 * `GET /v1/public/events/month-counts?year=YYYY` (004 design §3, EARS-16).
 * `month` is the 1-based calendar month (1..12); `count` is the number of
 * publish-visible (`published`/`live`/`ended`) events whose start instant (МСК)
 * falls in that month. Months with no events carry `count: 0` — the response is
 * always exactly 12 rows ({@link MonthlyEventCountsSchema}), so the picker never
 * has to fill gaps.
 */
export const MonthlyEventCountSchema = z.object({
  month: z.number().int().min(1).max(12),
  count: z.number().int().nonnegative(),
});
export type MonthlyEventCount = z.infer<typeof MonthlyEventCountSchema>;

/** The counts endpoint returns exactly the 12 months of the requested year (EARS-16). */
export const MonthlyEventCountsSchema = z
  .array(MonthlyEventCountSchema)
  .length(12);
export type MonthlyEventCounts = z.infer<typeof MonthlyEventCountsSchema>;

/**
 * The `month` query-param shape for the month read (`YYYY-MM`, months `01`..`12`).
 * A malformed value is a 400 at the controller before any read runs. NO baked
 * `message` (repo rule #200) — the boundary rejects structurally.
 */
export const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The `year` query-param shape for the counts read (`YYYY`). NO baked `message` (#200). */
export const YEAR_PARAM = /^\d{4}$/;

/**
 * The half-open UTC instant range `[start, end)` covering one МСК calendar month
 * — the single SSOT the month read filters on (`start <= starts_at < end`).
 * `start` is the first instant of the month at МСК midnight
 * (`YYYY-MM-01T00:00:00+03:00`); `end` is the first instant of the NEXT month at
 * МСК midnight (December rolls to next-year January). Moscow is permanently
 * UTC+3 ({@link MSK_UTC_OFFSET}), so no tz-db lookup is needed. Pure; throws a
 * `RangeError` on a malformed month (callers validate with {@link MONTH_PARAM}
 * first).
 */
export function mskMonthRange(month: string): { start: Date; end: Date } {
  if (!MONTH_PARAM.test(month)) {
    throw new RangeError(`not a YYYY-MM month: ${month}`);
  }
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const nextYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;
  const start = new Date(`${month}-01T00:00:00${MSK_UTC_OFFSET}`);
  const end = new Date(
    `${pad4(nextYear)}-${pad2(nextMonth)}-01T00:00:00${MSK_UTC_OFFSET}`,
  );
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError(`invalid МСК month: ${month}`);
  }
  return { start, end };
}

/**
 * The half-open UTC instant range `[start, end)` covering one МСК calendar year
 * — the range the per-month counts aggregate over. `start` = МСК midnight of
 * `YYYY-01-01`; `end` = МСК midnight of the next year's `01-01`. Pure; throws a
 * `RangeError` on a malformed year (callers validate with {@link YEAR_PARAM}).
 */
export function mskYearRange(year: string): { start: Date; end: Date } {
  if (!YEAR_PARAM.test(year)) {
    throw new RangeError(`not a YYYY year: ${year}`);
  }
  const start = new Date(`${year}-01-01T00:00:00${MSK_UTC_OFFSET}`);
  const end = new Date(
    `${pad4(Number(year) + 1)}-01-01T00:00:00${MSK_UTC_OFFSET}`,
  );
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError(`invalid МСК year: ${year}`);
  }
  return { start, end };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
