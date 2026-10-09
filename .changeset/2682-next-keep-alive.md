---
"@ds/admin": patch
"@ds/portal": patch
"@ds/doctor": patch
---

The admin, portal and doctor servers keep an idle connection open 125 s, longer than the proxy in front of them and the api hint they forward, so a request no longer lands on a connection the server is closing (#2682).
