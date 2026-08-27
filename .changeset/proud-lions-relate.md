---
"@ds/schemas": major
---

#1483 (ADR-0016 §2.8/§5): the taxonomy contract renames its curated book and
gains the two direction relations.

BREAKING — renamed exports: every `Topic*` schema and type is now `Direction*`
(the entity is a direction, and the SSOT must say what the domain says). Consumers
import the new names; nothing is aliased, because a compatibility alias would let
the old vocabulary survive a rename whose whole point is that it does not.

New contracts: `DirectionSpecialty*` (the link to one entry of the closed
Минздрав nomenclature) and `DirectionAdjacency*` (a DIRECTED edge with an open
`kind` label and an integer `weight` between 1 and 100). Both list schemas are
`.strict()`, so an unknown query key is refused rather than silently ignored.
