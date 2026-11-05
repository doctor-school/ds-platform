---
"@ds/api": minor
---

049 EARS-1, EARS-2: two new staff roles, `superadmin` and `broadcast_director`. Both are in the role vocabulary, the staff precedence of the `users.role` mirror (`superadmin` first, `broadcast_director` after the congress roles) and the TOTP policy, and every admin-session endpoint admits them. Live revalidation (ADR-0001 A4) asks the IdP about `superadmin` on a row naming it and about `broadcast_director` for a director-only session, answering `403 SUPERADMIN_REQUIRED` / `403 BROADCAST_DIRECTOR_REQUIRED` once the grant is withdrawn. The IdP seed creates both project roles.
