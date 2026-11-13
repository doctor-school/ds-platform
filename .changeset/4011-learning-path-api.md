---
"@ds/learning": minor
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
"@ds/api-client": minor
---

#4011: the first course path (024) — backend. New package `@ds/learning` (pure model: catalogs, layered rules with the platform seed and three presets, the evaluator and the rule-sentence builder; `./server`: admin and doctor services). Migration `0062_learning_path` adds the school → course → module → lesson → step structure, rule layers and presets, append-only progress facts and test attempts. The API serves the public path and lesson reads, the doctor's step reads, progress facts and exit-test attempts, and the admin structure, publish gate, video source / download file, rules and presets; the first completed lesson records one 025 `lesson.completed` fact.
