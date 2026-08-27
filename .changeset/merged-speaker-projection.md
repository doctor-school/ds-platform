---
"@ds/schemas": major
"@ds/api": major
---

012 EARS-8: one canonical merged speaker projection for every public surface.

**Breaking.** `PublicEventPage.speakers` is no longer a flat `{name, credentials}` array. It is now `PublicEventSpeakerList` — an array of the `PublicEventPageSpeaker` discriminated union on `source`: a legacy arm (`{source: "legacy", name, credentials}`) and an expert arm (`{source: "expert", expertId, expertSlug, name, credentials, photoUrl, role}`, `photoUrl` present-and-nullable, signed at read time). Any consumer that read a speaker entry as the flat shape must narrow on `source`; both arms still carry `name` and `credentials`, so a consumer that only reads those two fields needs no change.

Adds `GET /v1/public/events/:idOrSlug/speakers`, the standalone public read of that same ordered list (404 `RESOURCE_NOT_FOUND` for an unknown or unpublished event key).

Every public speaker surface — the event page, the upcoming-broadcast cards and the new endpoint — now resolves through the single `SpeakerProjectionService`, ordered position → source rank (expert before legacy) → stable id, with a draft/retired/removed linked expert falling back to the legacy row it matched. The duplicate assembly blocks in `EventsService` are gone.
