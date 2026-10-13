---
"@ds/schemas": minor
---

Doctor events reads refuse an impossible day (`2026-02-31`) or a `day`/`from`/`to`/`month`/`year` outside the served years 1900–2999 at the boundary, answering 400 instead of a 500 from the horizon or month arithmetic (#2831). The events page URL keeps the day shape only (`DoctorEventsFeedDayShapeSchema`), so a refused day still reaches the read and the feed block alone reports the failure.
