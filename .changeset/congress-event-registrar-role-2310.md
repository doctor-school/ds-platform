---
"@ds/api": patch
"@ds/db": patch
---

Add `event-registrar` to the API coarse-role vocabulary (044 EARS-17, #2310): the congress registrar is authorized from the Zitadel project-roles claim like every other role and only mirrored into `users.role`, the dev-stand/staging IdP converge seeds the project role key by default, and the golden IdP contract can declare it. No endpoint names the role yet — the authorization matrix is unchanged.
