---
"@ds/portal": minor
---

feat(portal): #197 enforce field validation/mask by construction — semantic field primitives + ESLint gate (003)

Portal auth forms were assembled from raw design-system `<Input>` + a per-form
loose resolver, so validation/mask was hand-wired field-by-field and easy to
forget — the root cause of the live defects #192 (`/login` identifier) and #196
(`/reset` identifier). This lands the enforced-by-construction layer of EARS-22
(003 design §8.2):

- **Five semantic field primitives** (`apps/portal/components/fields`):
  `EmailField`, `PhoneField`, `OtpField`, `PasswordField`, and `IdentifierField`
  (the email-or-phone union box). Each bakes in validation + (where relevant) the
  E.164 phone mask + a11y + RU copy and co-locates its zod resolver fragment, so
  no per-call wiring. The loose `@ds/schemas` request contracts are unchanged.
- **A custom ESLint gate** (`local/no-raw-auth-field-input`) that makes a raw
  credential `<Input>` impossible to render on the auth surfaces — the field must
  come from the primitives. Rides the existing `lint` CI job.
- **All auth surfaces migrated** with behavior preserved (#192/#175 intact), and
  **/reset identifier now validated + masked-aware** — the #196 fix.
