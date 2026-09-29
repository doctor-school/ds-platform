---
"@ds/auth-flow": major
"@ds/schemas": major
"@ds/api": major
"@ds/api-client": major
"@ds/doctor": patch
"@ds/portal": patch
---

One registration-confirmation mechanism on both storefronts (#2455).

- The doctor storefront now confirms a registration on its own `/verify` route
  (`apps/doctor/app/(auth)/verify/page.tsx`), the same `@ds/auth-flow/verify`
  step the Academy mounts: registration hands the visitor over with the address
  and the carried return target in the query. The in-place confirmation branch of
  the registration door is gone.
- ONE confirm command on both hosts: the 003 `POST /v1/auth/verify` (address +
  code). The doctor-storefront command `POST /v1/storefront/doctor/confirm`, its
  `DoctorConfirm*` schemas and SDK types are removed — it was that 003
  verification plus a server-side landing decision.
- The landing after confirmation is decided the same way on both hosts (owner
  decision «Б», 2026-09-29, 021 Amendment — 2026-09-29): the page of the эфир
  the visitor came from, even when it has ended or filled up (the page states
  that itself); an эфир that no longer exists → the default landing. The
  `/verify` mount asks the one public event read on every host.
- `AuthFlowHostConfig` breaking changes: `routes.verify` is required;
  `api.confirmPath`, `api.confirmCarriesReturnTarget` and
  `verify.deepLinkEntry` are removed (the verification mail is link-free, so the
  `/verify#email=` fragment is no address); the auth client's `confirm` is
  replaced by a typed `verify`. `resolveConfirmLanding` is removed.
- A signed-in visitor on the Academy `/verify` is sent to the landing the
  registration door would send them to (`/webinars`), not to `/account`.
