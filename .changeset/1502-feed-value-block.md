---
"@ds/schemas": major
"@ds/api-client": major
"@ds/api": minor
"@ds/doctor": minor
---

«Зачем это мне» on the specialty feed (018 EARS-7, #1502). Breaking for `@ds/schemas` and `@ds/api-client`: a `SpecialtyFeed` block is now a discriminated union on `kind` — read-backed kinds (`events`) keep `{ kind, read }`, the new `value` kind is `{ kind: "value", items: { title, body }[4], freeStatement }` with no `read` — so a consumer narrows on `kind` before reading `read`; `specialtyFeedBlocks(code, { value })` now takes the value block's content, and `specialtyFeedBlockRead` accepts only read-backed kinds. The api's feed envelope carries the value block right after the events block, one editorial copy for every specialty, closing on «Всё бесплатно для врача» (no new endpoint). The doctor feed renders it below the nearest events: four items and the free statement, naming nobody who finances the learning (LD-9).
