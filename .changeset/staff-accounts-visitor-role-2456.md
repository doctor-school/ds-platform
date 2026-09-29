---
"@ds/api": patch
"@ds/db": patch
---

Staff accounts are users (#2456): the account endpoints (`GET /v1/me/profile`, `GET`/`PUT /v1/me/display-name`) serve the visitor and platform-administrator roles (a registrar-only principal stays refused, 044 EARS-19), so a staff session opens its own profile and signs out from it instead of hitting the «Не удалось загрузить профиль» frame. The `users.role` mirror now follows the session's project-roles claim on every signed-in request (any staff role ⇒ that staff role, else `doctor_guest`), and the participant queries — the storefront sign-up count, the roster read model, the registrar's roster page (rows and total), the live room population, its expiry timer and the derived presence minutes — leave staff accounts out. Staff are onboarded with `doctor_guest` + `platform_admin` (runbook step 5; the golden admin and its stage mirror carry both).
