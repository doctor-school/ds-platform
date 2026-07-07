---
"@ds/schemas": minor
"@ds/api": patch
---

feat(events): 004 EARS-6 — draft not-found + non-public visibility policy

Pins the non-public visibility policy over the two 004 public read endpoints (the
design §2 visibility table) with a dedicated end-to-end spec
(`apps/api/test/events/visibility.e2e-spec.ts`): a `draft` event's public page is
not-found, **byte-for-byte indistinguishable** from a non-existent id (by slug and
by id — a hidden draft leaks no "exists but private" oracle), and `draft` / `ended`
/ `archived` never appear on the upcoming-broadcasts listing, so the active-broadcasts
projection only ever carries `published` / `live` cards (the EARS-10 invariant).

The policy now derives from a single `@ds/schemas` source of truth rather than inline
literals: a new `isPubliclyReachable(state)` predicate (mirroring `canTransition`) —
built from the `PUBLIC_EVENT_STATES` allow-list, not a `draft` denylist, so a future
non-public state is not-found by default — gates the public event page, and the
listing filter reads the `UPCOMING_BROADCAST_STATES` constant. No public API behaviour
changes (the mechanism was landed with EARS-1); this handler adds the authoritative
policy spec and single-sources its two applications.
