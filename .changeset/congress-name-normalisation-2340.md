---
"@ds/schemas": minor
"@ds/api": patch
---

The congress intake now cleans up the name a participant types (#2340, feature
044 EARS-33). « иван » is stored as «Иван», «ПЕТРОВ» as «Петров»,
«анна-мария» as «Анна-Мария» and «салтыков щедрин» as «Салтыков Щедрин»:
surrounding whitespace removed, every internal run of spaces collapsed to one,
and each name segment capitalised, where a segment ends at a space, a hyphen or
an apostrophe. It applies to the surname, the first name and the patronymic and
to nothing else — workplace, city and region keep the capitalisation the
participant gave them, because institution and place names do not obey a
two-rule pass. What an organiser reads off the roster and the printed attendance
sheet, and the display name of the account the intake creates, are all the
cleaned form.

The rule lives in the intake contract (`normaliseNameAnswer` in `@ds/schemas`),
not in an input mask on the congress site: the intake endpoint is public, so the
site's JavaScript cannot be the guarantee, and a mask would fight the
participant mid-word in the one field where that is least welcome. Only the
cleaned value is kept — unlike the contact phone, which keeps the typed form
beside its comparison key, there is nothing here to compare, and one spelling per
name is the point. The transform is idempotent, which it has to be: the same
declaration validates the stored answers column that validates the submission,
so it runs again on every read of a row it already cleaned. Existing rows are
left exactly as they are; no migration and no configuration change.
