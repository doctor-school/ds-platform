---
"@ds/doctor": patch
---

#2027 — a doctor who confirms their email is taken straight to what they came
for. The confirmation screen used to hand over to a «Почта подтверждена» card
with a «Вернуться к эфиру →» button and a secondary «в личный кабинет»: one more
screen and one more click between the code and the эфир. That step is gone — the
storefront now navigates to the honoured destination itself, exactly as the
Academy has always done after `/verify`.

Where it lands is unchanged and still decided by the server: the page the doctor
came from when the carried target is still live, the nearest honest destination
when it ended, filled up or was unpublished, and the events feed (or the
storefront home) for a doctor who arrived with nothing to return to. The
navigation replaces the spent code form rather than stacking on it, so Back does
not lead to a dead code entry. A confirmation whose sign-in replay fails still
verifies the email and still sends the doctor to the sign-in door carrying the
target.

The rule is now written down for both storefronts as standard S5 in the
`@ds/auth-flow` README, and the 021 spec carries the owner's decision as its
«Amendment — 2026-09-17».
