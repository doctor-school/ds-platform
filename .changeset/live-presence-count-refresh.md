---
"@ds/portal": patch
---

Room live «N врачей в комнате» presence count (006 EARS-5, #1122): lock the client
ack→header refresh path with a component regression test (increment, decrement, and
the inter-beat cadence gap that read as "frozen without a reload"), and stop the
heartbeat loop swallowing a failed beat with zero signal — a refused beat, schema
drift, or a transport failure now leaves a dev-visible `console.debug` breadcrumb
(best-effort loop unchanged: no user-facing error, no retry, last count held).
