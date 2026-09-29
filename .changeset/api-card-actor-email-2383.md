---
"@ds/api": patch
---

The participant card's attendance history names a registrar who has no display
name by their account email instead of the raw IdP subject id (044 EARS-36,
#2383); only a change made by a principal with no account row at all still
shows the raw id.
