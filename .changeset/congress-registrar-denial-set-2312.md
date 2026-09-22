---
"@ds/api": patch
"@ds/schemas": patch
"@ds/api-client": patch
---

Fence the `event-registrar` role to its allow-set (044 EARS-19, #2312): the role joins the `role → mfa_required` policy and the admin second-factor entry routes, so a registrar reaches the admin origin on the `platform_admin` TOTP flow and may hold a session — sign in, enrol/answer the factor, read back its own roles through the new `GET /v1/admin/auth/session`, sign out. Reach is unchanged everywhere else: every other real route, including every create, update and delete, omits the role and `AuthzGuard` refuses it. The generated matrix carries no denial-set column, so that half is proven by a sweep over the real registered route set.
