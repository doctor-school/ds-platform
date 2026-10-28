---
"@ds/db": patch
"@ds/api": patch
---

#3421: the Postgres pool now bounds opening a connection (TCP connect + startup handshake) with `connectionTimeoutMillis`, default 5000 ms (api: `DATABASE_CONNECT_TIMEOUT_MS`). A boot against an unresponsive data box rejects within that bound, so the boot-failure exit path exits 1 and the restart policy retries, instead of the process hanging forever.
