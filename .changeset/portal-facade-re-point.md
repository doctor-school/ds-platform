---
"@ds/portal": minor
---

Retire two 003-era portal scaffolds by pointing at shipped product surfaces: `/` now
server-redirects to the public `/webinars` listing (was a scaffold catalog card linking
to `/login`), and the post-auth default landing re-points from `/account` to
`/account/events` («Мои события»). Removes the now-unused `home` message block.
