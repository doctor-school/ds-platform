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
same normalised first author (`first-author-limit-reached` with
`{limit, used, firstAuthor}`). Creating an
abstract with `derivedFromId` («Подать тезисы по этой работе») copies the title
and authors of the author's own sent oral talk or poster — not a draft or a
withdrawn one — and links to it. A submission now carries `derivedFromId` and
`statements`.

The cabinet offers abstracts: «Начать заявку» on «Тезисы» opens the abstract
form — «Название тезисов», the authors in publication order, «Текст тезисов»
with its five sections and one total counter in the send panel («4 998 /
5 000», marked from 4 500, «осталось N» / «больше на N») — with the two
statements before the consent, sent with it. The refusals read in the canvas
words — «Сократите текст тезисов до 5 000 знаков — сейчас N», «Подтвердите,
что в тексте нет некорректных заимствований» / «… торговых наименований» —
and the first-author refusal names the author: «С первым автором «{ФИО}» уже
отправлено N тезисов из N — эту заявку отправить нельзя.» Like every failed
send, a refusal at the abstracts' limit or by the first-author rule keeps
«Текст заявки сохранён.» under it. A sent oral talk or
poster offers «Подать тезисы по этой работе» in the list and in its detail
while abstracts can be started; it opens the prefilled abstract draft. Each statement's and the consent's error line is part of its box's
aria-describedby, like the title and section fields.
