---
"@ds/schemas": minor
"@ds/api": minor
---

The event roster now carries the «возможный дубль» marker (#2327, feature 044
EARS-30): an entry is marked when another registration of the same event holds
the same normalised contact phone — the comparison key the intake writes onto
the registration answers. Two people submitting from one phone are still
accepted exactly like anyone else, with the same generic success body and no
hint that the number is already there: the intake is not an oracle, and sorting
a genuine family out from a genuine duplicate is the registrar's judgement, not
the server's.

The marker is derived on every read of the roster rather than stored as a flag.
A window count inside the roster query groups the event's registrations by that
normalised phone; nothing is written, no migration is added and no sweep exists,
so when the team removes one of the sharing registrations on request the
survivor's marker clears by itself, with no write to the surviving row. Only the
boolean leaves the query — the phone is neither selected nor returned — so the
roster read model keeps its no-registrant-PII invariant. A registration created
through the signed-in platform path carries no answers payload at all, and such
rows are never marked, not even against each other.

`@ds/schemas` gains the required `possibleDuplicate` field on the roster entry
contract. The read model has no HTTP route yet, so no SDK surface changes; the
registrar-facing indicator and its roster filter land next (#2328, #2329).
