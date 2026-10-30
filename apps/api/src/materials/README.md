# `materials` — the materials feed (feature 048)

Spec: `apps/docs/content/specs/features/048-materials-feed/`. #3512 opens the
module with the «Материалы» admin authoring surface (EARS-1, EARS-4…EARS-8,
EARS-19); the public feed and material reads follow (#3513).

## What it owns

- `materials` — the retained own-material row: kind (`news` | `column`),
  title, the news author line or the column's 012 expert, the optional 032
  partner, the allowlisted body document (`@ds/schemas` `material-body.ts`),
  `draft` | `published`, `first_published_at` set once.
- `feed_entries` — THE feed (Lead decision 8). `FeedEntriesRepository` is its
  only reader and writer; `OwnMaterialsFeedSource` writes an own material's card
  inside the transaction of its publish or published edit and removes it on
  unpublish. No admin endpoint writes the table directly.

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
