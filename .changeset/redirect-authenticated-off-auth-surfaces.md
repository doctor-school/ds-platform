---
"@ds/portal": patch
"@ds/admin": patch
---

fix(auth): redirect authenticated sessions away from auth surfaces to their destination (#675)

An already-authenticated visitor could still open the portal auth surfaces
(`/login`, `/register`, `/reset`, `/verify`) and the admin `/login`, and re-walk
the whole register→verify→login flow. Now an authenticated visitor hitting any of
those surfaces is redirected to their destination (portal → `/account`, admin →
the `events` root) with no auth form rendered: the portal wires a single session
guard into the shared `<AuthShell>`, and the admin wraps its login form in Refine's
`<Authenticated>`.
