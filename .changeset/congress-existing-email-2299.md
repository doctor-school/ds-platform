---
"@ds/api": minor
---

The congress intake now accepts an address the platform already knows (#2299 /
#2300 / #2301, feature 044 slice 3). Where slice 2 refused such a submission
generically, `POST /v1/congress/sign-up` attaches the registration to the
account that address already has and leaves every field of that account's own
profile byte-identical: the submitted surname, first name, patronymic,
workplace, city, region and contact phone are stored on the registration row
only. A congress form is not a profile editor, and an unauthenticated endpoint
must never be able to rewrite an existing doctor's account.

Both branches now run the SAME callback inside the same audited transaction, so
the written state and the response are identical by construction rather than by
two code paths agreeing. The registration insert is `ON CONFLICT (user_id,
event_id) DO NOTHING` and the consent row is written only when the published
version differs from the one last recorded for that account and purpose — a
repeat submission therefore answers exactly as the first one did and writes
nothing new, while a submission made after the consent text was republished
records exactly one fresh acceptance row at the new version.

Every path answers with the one `accepted` state and HTTP 200. That single
state is all the congress site needs to render its confirmation, and it is the
reason the site cannot tell whether the address was already on the platform.

The remaining difference between the two branches was latency — the new-account
branch really does create a user in the IdP. `@TimingEqualized` now takes an
optional route-specific floor, and the intake carries one: a conservative
default of one second, overridable through the new `CONGRESS_SIGNUP_TIMING_FLOOR_MS`
key and read per request, so raising it after a production measurement needs no
redeploy. The platform-wide 40 ms auth-door floor is below either branch and
equalised neither; the bare `@TimingEqualized()` used by the auth doors is
unchanged. A floor that is not whole milliseconds refuses the intake through the
same generic refusal as the other configuration keys, before any side effect,
rather than silently reverting to the default.

The confirmation email the success state promises still lands with slice 4
(#2304–#2306).
