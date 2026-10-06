---
"@ds/api": patch
---

Events: a new event with a Cyrillic title keeps its words in the slug — the title is transliterated through the canonical taxonomy slugify (`kongress-po-ortobiologii-…` instead of `event-…`); existing slugs are unchanged.
