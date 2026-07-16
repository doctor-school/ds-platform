---
"@ds/api": patch
---

fix(auth): the session-self surface (session/refresh/logout) admits a `platform_admin`-only principal, not just `doctor_guest` — an operator provisioned admin-only is no longer locked out of (and orphaning sessions on) the admin app (#1038).
