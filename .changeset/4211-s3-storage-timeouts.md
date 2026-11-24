---
"@ds/api": patch
---

#4211: object-storage calls are bounded — the S3 adapter now has a 5 s connect and a 20 s socket-idle timeout with at most 2 attempts, so a stalled store fails an upload with a readable error within ~50 s instead of hanging it. `exists()` / `getBytes()` answer «absent» only for a not-found reply; any other store failure rejects, so a stall can no longer clear an upload locator or acknowledge a cover deletion.
