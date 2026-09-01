---
"@ds/portal": patch
"@ds/design-system": minor
---

014 EARS-7 — the «запись готовится» plaque and an honest player failure boundary. An ended event whose recording is not published yet now shows the plaque in the player position, carrying the operator's own readiness day («до 18 июля», year appended across a year boundary) or an honest date-free line when no day was committed; it clears itself the moment something is published, because it derives purely from the recording projection state on a per-request render. Adds the `WebinarRecordingPlaque` design-system primitive. Also adds the portal's recording-player failure boundary: an embed that errors or delivers nothing within 12s is replaced by an explicit «Запись временно недоступна» message plus a retry that re-creates the frame — no silent dead or forever-spinning player. The boundary component is mounted by the player slice (#1343).
