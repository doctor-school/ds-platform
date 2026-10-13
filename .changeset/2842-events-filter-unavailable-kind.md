---
"@ds/design-system": major
"@ds/events-storefront": minor
---

019 EARS-7 — an applied «Вид события» the panel does not offer under the current reading stays on it as a selected, removable chip named from the published kind dictionary («Больше не проводится» for a withdrawn kind), so «Применено: N» always matches what the doctor sees; the empty state names such a kind the same way, never by its raw slug; a format value outside the fixed set is no longer counted as applied. Breaking for `@ds/design-system`: `EventsFilterLabels` gains the required `unavailableOption` label, so every host that builds the labels must supply it. `@ds/events-storefront` adds `fetchEventKindTitles` and `KindTitle`.
