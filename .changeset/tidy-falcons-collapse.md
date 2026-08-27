---
"@ds/doctor": minor
---

017 EARS-6 / EARS-7 — the doctor storefront now REMEMBERS the specialty a doctor
picks, and the home page opens targeted on every visit after the first.

Activating an entry is the whole command: there is no confirm, no draft and no
save control to reach afterwards, from the pointer or from the keyboard. The
catalog collapses to the row the canvas draws — the official name verbatim,
«Другое» included, a «сменить» control, and the line explaining that content is
picked by the chosen specialty and its adjacent fields. The row is drawn from
what the write RETURNED, never from the chip that was clicked, so the page can
only ever name a specialty the platform actually recorded.

A refusal claims nothing: the catalog stays open and fully usable, says in plain
Russian that the choice was not remembered, and the doctor simply chooses again.
«сменить» restores the FULL variant-Б catalog — the search field over the whole
book, the frequent set and the route to «Другое» — and re-choosing re-targets and
is remembered in turn.

The remembered choice is resolved on the server, so a return visit's first byte
of HTML is already the collapsed row rather than the catalog folding itself away
a moment after it painted. When that read cannot be answered the section holds
its loading render and re-issues the read from the browser instead of re-asking a
question the doctor has already answered. Nothing here gates the page: no modal,
no backdrop, no scroll lock, and the rest of the home page stays whole.
