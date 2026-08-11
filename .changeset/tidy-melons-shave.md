---
"@ds/schemas": minor
"@ds/api": minor
"@ds/admin": minor
---

011 EARS-6/7 — TOTP challenge on admin login, with the ADR-0001 §7 failure discipline behind it.

An enrolled `platform_admin` completing primary auth at the admin origin is now presented a TOTP challenge, and `POST /v1/admin/auth/mfa/verify` is the only thing that turns their pending authentication into `__Host-ds_admin_session` — verified against the IdP session itself, single-use within its window, with nothing on the admin surface reachable in between. A new `GET /v1/admin/auth/state` read reports where a browser sits in that flow (the enum and nothing else — no budget, no lock, no subject), which is what the admin app routes on now that the cookies carrying the answer are `HttpOnly`.

Failed verifications on **both** the enrollment and challenge surfaces now count against the shared per-user/per-IP budgets, append an `auth.mfa.failure` row, and soft-lock the account at the §7 threshold with an `auth.lockout.triggered` row and an email notice — a locked account is refused even on a correct code, and every refusal stays one uniform message.

`apps/admin` moves off the doctor-portal session onto the admin tier end to end: login → challenge or enrollment → admin, admin writes carrying the CSRF double-submit header, and the new RU challenge screen. Both code screens now disable their submit control until six digits are present, so a cleared field after a failed code no longer leaves a button that looks live and cannot act.
