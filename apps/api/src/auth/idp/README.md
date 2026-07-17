# `idp` — Zitadel adapter wire-shape notes

The port/adapter split (`idp.types.ts`, `ZitadelIdpClient`, `FakeIdpClient`) is
documented in [`../README.md`](../README.md). This file pins the **Zitadel
behaviour invariants proven live** (v4.15 dev-stand) that the adapter encodes,
so they are never re-derived from scratch or "fixed" by an upgrade attempt.
Implementation SSOT: [`zitadel.idp.ts`](./zitadel.idp.ts); provisioning
counterpart: `infra/dev-stand/idp/provision.sh`.

## `CreateUser` wire shape — `POST /v2/users/new` (#203)

The CURRENT resource API; replaces the deprecated `AddHumanUser`
(`POST /v2/users/human`).

- **`organizationId` is a REQUIRED top-level body field** — omitting it 400s
  (`invalid CreateUserRequest.OrganizationId: value length must be between 1
and 200`). `AddHumanUser` inferred the org from the service token; the
  resource API does not. Resolved by `resolveOrgId` (configured `IDP_ORG_ID`,
  else the service account's own org via `GET /management/v1/orgs/me`, cached).
- Human fields nest under a **`human` object** (`human.profile` /
  `human.email` / `human.phone` / `human.password`) — `AddHumanUser` had them
  top-level. The new user id comes back as `id` (not `userId`).
- **`returnCode: {}`** under `human.email` (and `human.phone`) suppresses
  Zitadel's auto-send of the verification code — the code is echoed in the
  create RESPONSE instead. Without it Zitadel auto-sends and the BFF's own
  send would produce TWO emails, the first code dead (#153
  single-delivered-code invariant).
- **Duplicate identifier → 409**, surfaced as `alreadyExisted` — never a throw
  (enumeration safety, EARS-16).
- Error taxonomy (#202): password-policy 400 → `IdpPasswordPolicyError`
  (generic 422); other deterministic 4xx → `IdpInvalidArgumentError` (4xx,
  never 500, never an oracle); 5xx / transport → `IdpUnavailableError` (503).

## Human user REQUIRES an email — a model invariant, not a version gap

Zitadel cannot create a login-capable human user without an `email`: confirmed
live across `AddHumanUser` v1/v2, `_import`, and `CreateUser` (whose proto
marks `SetHumanEmail email` required; `phone` is optional). An empty-string
email is also rejected, and no login-policy/instance toggle relaxes it. The
only "all fields optional" path (`v3alpha` schema-based users) is a different
user type NOT wired to the standard OIDC/password/session login flows — so
**upgrading Zitadel does not help**.

Consequence (EARS-2, #202): **email is the primary registration identifier;
phone is a secondary identifier** added/verified post-registration. The
phone-only register channel was removed (#204); login-by-phone + SMS-OTP login
(EARS-7) remain valid once a phone is attached.

## Role grant — v2 `AuthorizationService.CreateAuthorization` (#157/#203)

Replaces the deprecated management-v1 `POST /management/v1/users/{sub}/grants`.
On v4.15 only the connect/gRPC-transcoded URL is served:
`POST /zitadel.authorization.v2.AuthorizationService/CreateAuthorization` —
the clean `/v2/authorizations` REST alias **404s**. Body
`{ userId, projectId, organizationId, roleKeys: [roleKey] }` (v2 requires
`organizationId`; v1 inferred it). **409 `ALREADY_EXISTS` = success**
(idempotent — webhook/reconcile re-grant freely). This grant is the authz
source of truth: without it the token's `urn:zitadel:iam:org:project:roles`
claim is empty and `AuthzGuard` 403s.

## Verification / reset hops (User v2)

- Email resend: `POST /v2/users/{id}/email/resend` with `{ returnCode: {} }`
  (the older `/email/_send_code` spelling 404s live); verify:
  `POST /v2/users/{id}/email/verify`. Phone symmetric (`/phone/resend`,
  `/phone/verify`).
- Password reset: `POST /v2/users/{userId}/password_reset` with the
  `returnCode` oneof; set: `POST /v2/users/{userId}/password` with
  `verificationCode`.
- OTP factor registration: `POST /v2/users/{id}/{otp_email|otp_sms}` — 409
  means the factor already exists (tolerated).

## Emails: Zitadel-rendered vs BFF link-free

In a **Zitadel-rendered** email the button cannot be removed — `buttonText: ""`
falls through to the bundled default label, and the button row + URL render
unconditionally (custom email HTML templates are an unsupported, long-open
upstream feature request). A truly **link-free** email is achieved by moving
the send hop to `returnCode` and delivering through the BFF mailer — shipped
for the email-verify and password-reset codes (EARS-29, #910/#1045; see
[`../../mailer/README.md`](../../mailer/README.md)). The still-Zitadel-sent
login email-OTP (EARS-6) keeps a sanctioned subordinate button whose
`sendCode.urlTemplate` is the BARE portal `/login` origin — no placeholders,
nothing a mail scanner's GET prefetch can consume (#878).

## SMS OTP message text (`verifysmsotp`, #226)

- **Only the `text` field is customizable** for this message type:
  `PUT /admin/v1/text/message/verifysmsotp/{lang}` silently DROPS
  `title`/`subject`/`greeting`/… (a `GET` returns them `null`) — Zitadel's
  i18n bundle defines only `Text` for `VerifySMSOTP` in every language; the
  other fields are email-only.
- **The code variable is `{{.OTP}}`** — NOT `{{.Code}}`, which some Zitadel
  docs cite and which renders blank for this type.
- **6 benign warnings per SMS OTP send**
  (`VerifySMSOTP.{Title,PreHeader,Subject,Greeting,ButtonText,Footer} not
found in language "…"`): not language-specific, not caused by custom copy,
  not removable via the message-text API — the renderer translates the full
  email field-set for any message type regardless of channel. Upstream
  [zitadel/zitadel#9636](https://github.com/zitadel/zitadel/issues/9636)
  downgraded it from send-blocking to a cosmetic warning; on v4.15 the SMS
  sends fine.
- The branded RU copy is provisioned by `provision.sh` step 8.bis.

## Verifying the delivery mode — query Zitadel, never trust the flag

The api sends no OTP email/SMS itself — **Zitadel** does, through whichever
notification provider is currently ACTIVE; the `email-delivery-real` /
`sms-delivery-real` flags only repoint Zitadel via the
[`delivery-reconcile`](../../delivery-reconcile/README.md) module. So the
ground-truth check of a delivery-mode flip is the **active provider**, not the
flag value: `POST {IDP_ISSUER}/admin/v1/smtp/_search` (service-token auth,
body `{}`) → the entry with `active: true`, matched by its stable
`description` (SSOT: `delivery-reconcile.types.ts` `SMTP_DESCRIPTION_*` /
`SMS_DESCRIPTION_*`, mirrored by `provision.sh`). SMS symmetric:
`POST {IDP_ISSUER}/admin/v1/sms/_search`. Activation:
`POST /admin/v1/smtp/{id}/_activate` (`/sms/{id}/_activate`) — a no-op on an
already-active provider.
