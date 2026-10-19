---
"@ds/api": minor
"@ds/schemas": minor
"@ds/db": minor
"@ds/admin": minor
---

The congress confirmation email now takes «{место}» from the registered event
itself (#2517, 044 EARS-13 amendment). Every event gains an optional
«Место проведения» field in the admin event form (`events.venue`, free text up
to 300 characters, trimmed; an emptied field stores no venue), and an
administrator's edit reaches the next email with no deployment. A congress
sign-up (site form or desk) whose event has no venue is refused with the same
generic refusal as before, before any account is created.

Migration 0049 adds the column and sets the production congress event's venue.
The `CONGRESS_SIGNUP_EVENT_VENUE` environment key is removed: the API no longer
reads it, and the deploy needs no new key — the stale line may be deleted from
the server env file after the release.
