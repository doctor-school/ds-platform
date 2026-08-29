---
"@ds/api": major
"@ds/db": major
"@ds/schemas": major
---

#1606: converge Expert authoring with an optional unique User link and replace
the stored free-form Expert name with required family/given names plus optional
patronymic. Expert display names and slugs are now server-derived, and mutation
input no longer accepts a slug.
