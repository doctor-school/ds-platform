---
"@ds/admin": patch
---

Admin list surfaces stop clipping at phone widths. The admin chrome row (brand + nav + sign-out) now wraps below the `sm` breakpoint instead of forcing the page ~113px wider than a 390px viewport — which cut off «Выйти» and, because a horizontal swipe panned the whole page, made the events table's own scroll wrapper unreachable, so «Дата» / «Статус» / «Действия» read as clipped. The list headings on `/events` and on the shared taxonomy list shell also stack above their «Создать …» button at the same breakpoint, instead of the button overlapping the description text. Desktop rendering is unchanged.
