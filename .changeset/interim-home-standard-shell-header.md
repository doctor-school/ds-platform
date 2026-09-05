---
"@ds/portal": patch
---

Interim Academy home mounts the standard app-shell header on / (#1877). The
`@chrome` root slot returned `null`, so `/` was the one portal route without
the 008 `AppShellHeader`; the interim landing stub carried a bespoke header of
its own whose «Войти» and `≡` controls were permanently `disabled`. The slot
now mounts `AppShellHeader` unchanged — logo → `/webinars`, «Эфиры», «Мои
события», the theme toggle and the real «Войти» → `/login` (avatar → `/account`
for a signed-in doctor), plus the mobile `≡` dropdown — and the stub's bespoke
header and its local theme toggle are deleted. This moves the interim page onto
the canonical 013 design §7 / EARS-16 behaviour; no navigation entry is added
for a route that does not exist yet (LD-10).
