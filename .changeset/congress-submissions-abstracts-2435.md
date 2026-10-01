---
"@ds/api": minor
"@ds/schemas": minor
"@ds/congress-submissions": minor
"@ds/api-client": minor
---

Congress abstracts on the author's submissions API (046 EARS-21…25, #2435): an
abstract draft carries the title, the authors with no presenting mark and five
plain-text sections — «Актуальность», «Цель», «Материалы и методы»,
«Результаты и обсуждение», «Выводы» — each non-empty at send and together at
most 5000 characters by `abstractLength` (`@ds/schemas`: each section trimmed,
CRLF as one line break, spaces and line breaks counted), the same function the
form's counter uses; above it the send is refused (`field-invalid` on `body`
with `{length, max}`). The send takes the two statements «В тексте нет
некорректных заимствований» and «В тексте нет торговых наименований»
(`statements: ["plag", "trade"]`), each missing one refused as
`statement-required`, and stores them with their instant; publication is
covered by the one submission consent. With the event's first-author rule on,
the kind's limit also binds every submitter's counted submissions with the
same normalised first author (`first-author-limit-reached`). Creating an
abstract with `derivedFromId` («Подать тезисы по этой работе») copies the title
and authors of the author's own sent oral talk or poster — not a draft or a
withdrawn one — and links to it. A submission now carries `derivedFromId` and
`statements`.

The cabinet model knows the abstract form: its five fields, the total counter
(«4 998 / 5 000», marked from 4 500, «осталось N» / «больше на N»), and the
refusals in the canvas words — «Сократите текст тезисов до 5 000 знаков —
сейчас N», «Подтвердите, что в тексте нет некорректных заимствований» /
«… торговых наименований», and «Можно отправить не больше N тезисов с одним и
тем же первым автором».
