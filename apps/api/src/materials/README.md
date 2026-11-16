# `materials` — the materials feed (feature 048)

Spec: `apps/docs/content/specs/features/048-materials-feed/`. #3512 opens the
module with the «Материалы» admin authoring surface (EARS-1, EARS-4…EARS-8,
EARS-19); #3513 adds the public feed and material reads; #3993 opens slice 2
with the «Источники» source list (EARS-20…EARS-23).

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
  `FeedSourcesRepository` in the command's transaction. The source check that
  binds the channel id and sets the status is the Telegram connector's
  (#3994); until it lands a source stays «Не проверен».

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
