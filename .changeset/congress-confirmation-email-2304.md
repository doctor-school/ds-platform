---
"@ds/api": minor
---

The congress intake now sends the participant the confirmation email its
`accepted` answer has been promising (#2304 / #2305 / #2306, feature 044 slice
4). The mail names the event, its start in Moscow wall-clock time and the venue,
and carries one branch: an address the platform did not know is told an account
was created for it and that no password is needed, while an address that already
had an account is told the registration was added to the account it already has.
That branch lives in the inbox of the person the fact is about — the HTTP
response stays the single `accepted` state on both paths, so the congress site
still cannot tell the two apart.

The send runs AFTER the transaction has committed and is never awaited by the
response: a slow, unreachable or hostile relay can neither delay an accepted
registration nor turn it into a refusal. Its outcome is not a log line. Each
registration row now carries `confirmation_mail_status` (`sent` | `failed`) and
`confirmation_mail_at`, added by migration `0038_registration_confirmation_mail`
as nullable columns — `NULL` means no dispatch was ever attempted, which is what
the platform-origin registrations read. The dispatcher re-reads that column
before sending, so a participant who submits the form twice receives exactly one
email, and a row left `failed` (or `NULL` by an interrupted attempt) sends again
on the next submission. That is the entire recovery mechanism: no outbox, no
scheduled sweep, nothing to operate.

Deployments gain one REQUIRED key, `CONGRESS_SIGNUP_EVENT_VENUE`, the venue the
mail names. `events` has no venue column and 044 adds no admin-editable
settings, so the venue is a per-deployment constant of this congress exactly as
the registration window is. It is validated with the other congress keys: unset
or blank refuses every submission through the same generic refusal, before any
side effect, rather than mailing a confirmation with a blank place in it.
