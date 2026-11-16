# `materials` — the materials feed (feature 048)

Spec: `apps/docs/content/specs/features/048-materials-feed/`. #3512 opens the
module with the «Материалы» admin authoring surface (EARS-1, EARS-4…EARS-8,
EARS-19); #3513 adds the public feed and material reads; #3993 opens slice 2
with the «Источники» source list (EARS-20…EARS-23); #3994 adds the Telegram
connector in `telegram/` (EARS-24…EARS-29, EARS-31, EARS-36).

## What it owns

- `materials` — the retained own-material row: kind (`news` | `column`),
  title, the news author line or the column's 012 expert, the optional 032
  partner, the allowlisted body document (`@ds/schemas` `material-body.ts`),
  `draft` | `published`, `first_published_at` set once.
- `feed_entries` — THE feed (Lead decision 8). `FeedEntriesRepository` is its
  only reader and writer; `OwnMaterialsFeedSource` writes an own material's card
  inside the transaction of its publish or published edit and removes it on
  unpublish. No admin endpoint writes the table directly. The card image is
  the cover's durable media key (`image_ref`, a registered media slot), signed
  at the public read — never a stored signed URL, which expires.
- `feed_sources` (slice 2, #3993) — the official network accounts the feed
  takes posts from (`telegram` in slice 2): the lowercase public username, on /
  off, the EARS-31 status. `FeedSourcesAdminController` serves
  `GET/POST /v1/admin/feed-sources`, `PATCH …/{id}` (address edit) and
  `POST …/{id}/disable|enable`. Never deleted. Its two marks on the source's
  `feed_entries` — the `href` rewrite of an address change and the
  `source_off` mirror of «Выключить» / «Включить» — are written by
  `FeedSourcesRepository` in the command's transaction. Add, address edit and
  switch-on run the EARS-31 source check at once, after the commit
  (`FeedSourcesService.checkAtOnce`, bounded at 15 s): the response carries
  the checked status, and a failed or unreachable check never fails the
  write. The check binds the channel id; a source still unbound (Telegram was
  unreachable) is bound by the first webhook update whose `chat.username`
  equals its address.
- `feed_entry_messages` (slice 2, #3994) — the dedup key of Telegram
  entries: every message id that went into an entry (one per post, each part
  of an album), keyed `(feed_source_id, message_id)`.
- `telegram/` (slice 2, #3994) — the Telegram connector:
  - `telegram-bot-api.client.ts` — the ONLY caller of `api.telegram.org`
    (ADR-0011 §2.2 channel #10): `setWebhook`, `getWebhookInfo`, `getMe`,
    `getChat`, `getChatMember`, `getFile` and the file download, Zod-checked
    parameters and responses, the token never in a logged or thrown string,
    one log line per call (method, HTTP status, duration, outcome).
    `telegram-bot-api.fake.ts` is its test double (`TELEGRAM_BOT_API`).
  - `telegram-config.ts` — `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` /
    `TELEGRAM_WEBHOOK_URL`; `null` (connector off) unless token and secret
    are both set.
  - `telegram-webhook.middleware.ts` + `telegram-webhook.controller.ts` —
    `POST /v1/integrations/telegram/webhook`: 404 while off, 401 on an absent
    or wrong secret (constant time, in Fastify's `onRequest` phase, before the
    body is read), 200 for every processed or dropped update, 500 on our own
    failure so Telegram redelivers.
  - `telegram-post-mapping.ts` — the pure EARS-26 mapping (text cut, preview
    size, drop reasons); `telegram.feed-source.ts` — the only writer of
    Telegram entries: one transaction per update (source matched and locked,
    id bound, entry written with the album and edit rules, EARS-27/28). A new
    preview candidate is written `preview_state = pending` with its
    `preview_file_id`, no `image_ref`; the copy is the preview service's.
  - `telegram-preview.service.ts` — the EARS-29 preview copy, run once by the
    webhook after its transaction commits and retried by a `@Cron` every 10
    minutes (backoff `previewRetryDelayMinutes` in
    `feed-entries.repository.ts`, counted in `preview_attempts`, spanning at
    least 24 h, then `failed`): a fresh `getFile`, a file over 20 MB refused
    before the download, the 012 `StillImageNormalizer`, a PUT under the
    server key `feed-previews/<entry id>/<sha256>.webp`, then `image_ref` +
    `done` — guarded on the medium the copy started from, so a racing edit
    wins. A replaced or superseded copy is a 012 cleanup job (entity kind
    `feed_entry`). It never throws and never touches the source's status.
  - `telegram-source-check.service.ts` — the EARS-31 check: hourly
    (`@Cron`) for every switched-on Telegram source and at once on add / edit
    / switch-on. `getWebhookInfo`, `getChat` (bound id, else `@<address>`),
    `getMe` + `getChatMember`; one fixed reason in the design table's order
    (`SOURCE_CHECK_REASONS`), «Telegram недоступен» on a timeout or network
    failure; binds the id in the same write when the channel's username
    equals the address ignoring case. The verdict is written only while the
    source is still on at the judged address, and never bumps `version`.
  - `telegram-webhook-registration.ts` + `scripts/telegram-set-webhook.ts`
    (`pnpm --filter @ds/api telegram:set-webhook`) — the operator's EARS-24
    registration: `setWebhook` with `TELEGRAM_WEBHOOK_URL`, the secret and
    `allowed_updates = ["channel_post", "edited_channel_post"]`; prints the
    URL and update types Telegram holds, never the token or the secret.

## Properties worth stating

1. **012 and 032 are read, never written.** A column's expert and a partner are
   referenced by id, checked non-retired on write (FOR SHARE) and judged at the
   read for their public state and current names (Lead decision 11).
2. **Shared mechanisms, not copies.** Idempotency records, the RFC 7807 problem
   filter and the slug primitives come from `taxonomy/` and `@ds/schemas`.
3. **The card date never moves.** The entry's `published_at` is the material's
   `first_published_at`; an edit rewrites the card and keeps it, a re-publish
   restores it (EARS-5, EARS-6).
4. **The cover is a 012 media slot.** `materials.cover_ref` rides the taxonomy
   upload pipeline (shared normalizer, upload locator, `media_cleanup_jobs` with
   `entity_kind = material` on replace / clear) and is registered with the
   `MediaSlotRegistry` from `MaterialsModule.onModuleInit`, so neither media
   sweep deletes a live cover (048 EARS-1, #3572).
5. **Two anonymous reads (#3513).** `GET /v1/public/feed?cursor=&limit=` reads
   `feed_entries` joined only to the column's 012 expert and the 032 partner
   (`publicFeedPageQuery`, never `materials`; V-6), newest first with ties by
   id on the shared microsecond-exact keyset of `taxonomy/public-event-cursor.ts`;
   a column is kept only while its expert is public and its source line is
   `expertShortName` («Страхов М. А.») built at the read.
   `GET /v1/public/materials/{slug}` answers a published material (a column only
   while its expert is public) with the full `expertDisplayName`, and the same
   `404` for draft, unknown and non-public. Both project `partner` through the
   032 `organisationPubliclyDisplayed` predicate, which never hides a material
   (EARS-9, EARS-10, EARS-11, EARS-19).
6. **Row-local marks, no join (slice 2).** The feed read excludes
   `hidden_at IS NOT NULL` and `source_off` entries on the entry row itself, so
   it never reads `feed_sources` (EARS-22, Lead decision 11). It serves only
   the platforms in `FEED_CARD_PLATFORMS` — those the card contract has a
   member for — so a stored network entry is never served before its card
   (048-design §Delivery slices (slice 2)). The admin
   controllers share `admin-write.http.ts` (id shape, `If-Match`, field errors,
   idempotent replay).
