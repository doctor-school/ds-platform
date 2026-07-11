---
"@ds/api": patch
---

007 EARS-2 (#627): garbage-collect superseded program-PDF objects on reference swap. A successful PDF replacement now deletes the superseded object key from object storage after the swap is durably committed (best-effort — a storage failure warn-logs the orphan key and never fails the edit). The `ObjectStorage` port gains `delete(key)` (S3 adapter + in-memory fake).
