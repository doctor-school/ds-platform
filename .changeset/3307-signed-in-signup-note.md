---
"@ds/design-system": major
"@ds/event-page": patch
---

The event page's sign-up footnote follows the viewer: a guest keeps «Нужна регистрация — вернём вас на эту страницу.», a signed-in doctor not yet registered reads «Спишем N Pul при записи.» from the event's own cost, and a zero-cost event carries no footnote (#3307). `eventSignupCardProps` takes a required `viewer: EventSignupViewer` argument.
