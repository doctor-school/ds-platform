---
"@ds/db": minor
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

The colleagues' sign-up count is hidden by default on every event (007 EARS-12, 019 EARS-19, #3479). Migration `0053` sets `events.hide_sign_up_count` to `default true` and back-fills `true` on every existing event, so every public read (doctor feed and month read, 018 nearest-events block, Academy listing, 020 event page) serves `signUpCount: null` / `signUps: null` until an operator turns «Скрыть число записавшихся» off for that event. `CreateEventRequest.hideSignUpCount` now defaults to `true` when omitted; `UpdateEvent` is unchanged. `@ds/admin`: the event create form starts «Скрыть число записавшихся» ticked; the edit form keeps showing the event's own state.
