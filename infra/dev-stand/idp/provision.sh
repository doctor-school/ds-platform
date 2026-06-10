#!/usr/bin/env bash
# DS Platform — Zitadel OIDC application provisioner (idempotent, scriptable)
#
# Creates everything the api BFF needs to complete the OIDC login dance against
# the dev-stand Zitadel: a project, a web/OIDC application (authorization_code +
# refresh_token), redirect URIs for the api and portal, and the project-role
# claim assertion so `urn:zitadel:iam:org:project:roles` is emitted in the token
# (003 F2 parses it). It also seeds the `doctor_guest` project role.
#
# This replaces console click-paths with a committed, re-runnable script. Every
# step is idempotent: re-running it converges, it does not duplicate.
#
# Auth: a bootstrap **PAT** for a machine user with org-owner scope, created
# declaratively at instance init via ZITADEL_FIRSTINSTANCE_* (see bootstrap.md).
# Pass it via PAT (env) or --pat-file. The PAT is a secret — never commit it.
#
# Usage:
#   IDP_BASE_URL=http://truenas.local:9080 PAT="$(cat pat.txt)" ./provision.sh
#   ./provision.sh --base-url http://truenas.local:9080 --pat-file ./idp-pat.txt
#
# Requires: bash, curl, jq.
#
# Outputs (stdout, machine-parseable):
#   IDP_CLIENT_ID=<oidc client id>
#   IDP_CLIENT_SECRET=<oidc client secret>   # printed ONCE on creation only
#   IDP_PROJECT_ID=<project id>
set -euo pipefail

# ── args / env ───────────────────────────────────────────────────────────────
BASE_URL="${IDP_BASE_URL:-}"
PAT_VALUE="${PAT:-}"
PAT_FILE=""
PROJECT_NAME="${IDP_PROJECT_NAME:-ds-platform-dev}"
APP_NAME="${IDP_APP_NAME:-ds-platform-dev}"
# Redirect URIs: api BFF callback + portal. Ports are the recipe defaults; the
# api callback path mirrors the BFF OIDC callback route. Override via env.
REDIRECT_URIS="${IDP_REDIRECT_URIS:-http://localhost:3000/auth/callback,http://localhost:3100/auth/callback}"
POST_LOGOUT_URIS="${IDP_POST_LOGOUT_URIS:-http://localhost:3000,http://localhost:3100}"
# Project role to seed (the live BFF test asserts the roles claim is parsed).
SEED_ROLE="${IDP_SEED_ROLE:-doctor_guest}"

# Delivery-mode flags (#176) — switch Zitadel's email/SMS providers between the
# free dev sinks (default) and the REAL providers, the env-flag precedent of
# apps/api's BOT_PROTECTION_ENABLED. Steps 6/7 CONVERGE the active provider to
# the selected mode on every run.
#   EMAIL_DELIVERY_MODE = mailpit | real   (default mailpit)
#   SMS_DELIVERY_MODE   = sink    | real   (default sink)
# `real` SMS COSTS MONEY, so it is opt-in and OFF by default (see bootstrap.md).
EMAIL_DELIVERY_MODE="${EMAIL_DELIVERY_MODE:-mailpit}"
SMS_DELIVERY_MODE="${SMS_DELIVERY_MODE:-sink}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --pat) PAT_VALUE="$2"; shift 2 ;;
    --pat-file) PAT_FILE="$2"; shift 2 ;;
    --project-name) PROJECT_NAME="$2"; shift 2 ;;
    --app-name) APP_NAME="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$PAT_FILE" ]] && PAT_VALUE="$(tr -d '\r\n' < "$PAT_FILE")"
: "${BASE_URL:?set IDP_BASE_URL or --base-url (e.g. http://truenas.local:9080)}"
: "${PAT_VALUE:?set PAT or --pat-file (the FIRSTINSTANCE bootstrap PAT)}"
BASE_URL="${BASE_URL%/}"

for bin in curl jq; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin" >&2; exit 3; }
done

# ── http helper ──────────────────────────────────────────────────────────────
# api <METHOD> <PATH> [json-body]  ->  prints response body, fails on non-2xx
api() {
  local method="$1" path="$2" body="${3:-}" resp code
  resp="$(curl -sS -w $'\n%{http_code}' -X "$method" "${BASE_URL}${path}" \
    -H "Authorization: Bearer ${PAT_VALUE}" \
    -H "Content-Type: application/json" \
    ${body:+-d "$body"})"
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "API ${method} ${path} -> HTTP ${code}: ${body}" >&2
    return 1
  fi
  printf '%s' "$body"
}

# Like api(), but treats Zitadel's "No changes" 400 as success — an idempotent
# update that finds nothing to change is the desired converged state, not a fail.
api_idempotent() {
  local out
  if out="$(api "$@" 2>/tmp/.idperr)"; then
    printf '%s' "$out"
    return 0
  fi
  if grep -q "No changes" /tmp/.idperr 2>/dev/null; then
    echo "(already converged — no changes)" >&2
    return 0
  fi
  cat /tmp/.idperr >&2
  return 1
}

# Like api(), but for the SMTP/SMS provider `_activate` calls in the converge
# branches (steps 6/7). A freshly converged provider must be (re)activated, but
# on a SAME-MODE re-run the provider is ALREADY ACTIVE, and Zitadel rejects a
# redundant activation with a precondition error whose wording is version-
# dependent (an "already active"-class message, NOT the literal "No changes"
# that api_idempotent swallows). One supervised same-mode re-run must converge
# to a no-op, not abort under `set -euo pipefail`, so this helper treats BOTH
# the "No changes" and the already-active precondition as success. Scoped to the
# activate calls ONLY — the strict api_idempotent stays on the project/app/member
# PUTs so genuine errors there are never masked.
api_activate() {
  local out
  if out="$(api "$@" 2>/tmp/.idperr)"; then
    printf '%s' "$out"
    return 0
  fi
  # Match case-insensitively on the converged-state phrases. Kept narrow: the
  # "already active" precondition (and its terse "already" variants) plus the
  # "No changes" string — anything else is a real failure and still aborts.
  if grep -qiE "no changes|already active|already" /tmp/.idperr 2>/dev/null; then
    echo "(provider already active — no changes)" >&2
    return 0
  fi
  cat /tmp/.idperr >&2
  return 1
}

echo "Provisioning Zitadel OIDC at ${BASE_URL}" >&2

# ── 1. ensure project ────────────────────────────────────────────────────────
# Search by name; create if absent. The project-role assertion flag makes
# Zitadel emit `urn:zitadel:iam:org:project:roles` in the userinfo/token.
PROJECT_ID="$(api POST /management/v1/projects/_search \
  "$(jq -nc --arg n "$PROJECT_NAME" '{queries:[{nameQuery:{name:$n,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')" \
  | jq -r --arg n "$PROJECT_NAME" '.result[]? | select(.name==$n) | .id' | head -n1)"

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  PROJECT_ID="$(api POST /management/v1/projects \
    "$(jq -nc --arg n "$PROJECT_NAME" \
       '{name:$n, projectRoleAssertion:true, projectRoleCheck:false, hasProjectCheck:false}')" \
    | jq -r '.id')"
  echo "created project ${PROJECT_ID}" >&2
else
  # Converge the assertion flag on an existing project (idempotent update).
  api_idempotent PUT "/management/v1/projects/${PROJECT_ID}" \
    "$(jq -nc --arg n "$PROJECT_NAME" \
       '{name:$n, projectRoleAssertion:true, projectRoleCheck:false, hasProjectCheck:false}')" \
    >/dev/null
  echo "reusing project ${PROJECT_ID}" >&2
fi

# ── 2. ensure seed project role ──────────────────────────────────────────────
IFS=',' read -r -a _roles <<< "$SEED_ROLE"
for role in "${_roles[@]}"; do
  role="$(echo "$role" | tr -d ' ')"
  [[ -z "$role" ]] && continue
  if api POST "/management/v1/projects/${PROJECT_ID}/roles/_search" '{}' \
       | jq -e --arg k "$role" '.result[]? | select(.key==$k)' >/dev/null; then
    echo "role ${role} exists" >&2
  else
    api POST "/management/v1/projects/${PROJECT_ID}/roles" \
      "$(jq -nc --arg k "$role" '{roleKey:$k, displayName:$k, group:""}')" >/dev/null \
      && echo "created role ${role}" >&2
  fi
done

# ── 3. ensure OIDC web application ───────────────────────────────────────────
# Build the redirect / post-logout arrays from the CSV inputs.
REDIRECT_JSON="$(jq -nc --arg s "$REDIRECT_URIS" '$s | split(",") | map(gsub("^\\s+|\\s+$";""))')"
LOGOUT_JSON="$(jq -nc --arg s "$POST_LOGOUT_URIS" '$s | split(",") | map(gsub("^\\s+|\\s+$";""))')"

EXISTING_APP="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/_search" \
  "$(jq -nc --arg n "$APP_NAME" '{queries:[{nameQuery:{name:$n,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')" \
  | jq -r --arg n "$APP_NAME" '.result[]? | select(.name==$n) | .id' | head -n1 || true)"

# OIDC app payload: web app type, authorization_code grant + refresh_token,
# BASIC client auth (a confidential web/BFF client gets a client_secret),
# dev mode on (allows http:// redirect URIs on the dev-stand).
APP_PAYLOAD="$(jq -nc \
  --arg n "$APP_NAME" \
  --argjson redirect "$REDIRECT_JSON" \
  --argjson logout "$LOGOUT_JSON" \
  '{
     name:$n,
     redirectUris:$redirect,
     postLogoutRedirectUris:$logout,
     responseTypes:["OIDC_RESPONSE_TYPE_CODE"],
     grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
     appType:"OIDC_APP_TYPE_WEB",
     authMethodType:"OIDC_AUTH_METHOD_TYPE_BASIC",
     version:"OIDC_VERSION_1_0",
     devMode:true,
     accessTokenType:"OIDC_TOKEN_TYPE_JWT",
     accessTokenRoleAssertion:true,
     idTokenRoleAssertion:true,
     idTokenUserinfoAssertion:true
   }')"

if [[ -n "$EXISTING_APP" && "$EXISTING_APP" != "null" ]]; then
  # Update config (idempotent). client_id stays; secret is NOT re-emitted on
  # update — regenerate explicitly via _generate_client_secret if it was lost.
  api_idempotent PUT "/management/v1/projects/${PROJECT_ID}/apps/${EXISTING_APP}/oidc_config" \
    "$(echo "$APP_PAYLOAD" | jq 'del(.name)')" >/dev/null
  APP_DETAIL="$(api GET "/management/v1/projects/${PROJECT_ID}/apps/${EXISTING_APP}")"
  CLIENT_ID="$(echo "$APP_DETAIL" | jq -r '.app.oidcConfig.clientId')"
  echo "reused app ${EXISTING_APP} (client secret not re-emitted on update;" >&2
  echo " run _generate_client_secret to rotate)" >&2
  CLIENT_SECRET=""
else
  CREATED="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "$APP_PAYLOAD")"
  CLIENT_ID="$(echo "$CREATED" | jq -r '.clientId')"
  CLIENT_SECRET="$(echo "$CREATED" | jq -r '.clientSecret // ""')"
  echo "created OIDC app (appId $(echo "$CREATED" | jq -r '.appId'))" >&2
fi

# ── 4. ensure Login V2 instance feature ──────────────────────────────────────
# The headless BFF session->token exchange (EARS-8) links a checked session to a
# pending OIDC auth request via POST /v2/oidc/auth_requests/{id}. That API only
# resolves an auth request CREATED UNDER LOGIN V2 — with the feature off the
# authorize hop files a v1 auth request the v2 API can't see (404 "Auth Request
# does not exist", proven live #146). compose.core.yml turns it on at instance
# init (ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED); this converges it on
# any instance initialised before that default (idempotent). No baseUri is set:
# the BFF never renders the v2 login UI, it only drives the auth_requests + token
# endpoints served by the core binary.
api_idempotent PUT /v2/features/instance '{"loginV2":{"required":true}}' >/dev/null \
  && echo "loginV2 feature ensured (required)" >&2

# ── 5. grant IAM_LOGIN_CLIENT to the bootstrap machine user ───────────────────
# Calling /v2/oidc/auth_requests/{id} needs the dedicated IAM_LOGIN_CLIENT role —
# IAM_OWNER alone is NOT sufficient (Zitadel returns 403 "No matching permissions
# found", AUTH-AWfge). Grant it to the machine user this PAT belongs to (the
# FIRSTINSTANCE `ds-bootstrap`, override via IDP_BOOTSTRAP_USERNAME) on top of its
# existing roles. Idempotent: re-running yields "No changes".
BOOTSTRAP_USERNAME="${IDP_BOOTSTRAP_USERNAME:-ds-bootstrap}"
BOOTSTRAP_UID="$(api POST /v2/users \
  "$(jq -nc --arg u "$BOOTSTRAP_USERNAME" '{queries:[{userNameQuery:{userName:$u,method:"TEXT_QUERY_METHOD_EQUALS"}}]}')" \
  | jq -r '.result[0].userId // empty')"
if [[ -n "$BOOTSTRAP_UID" ]]; then
  EXISTING_ROLES="$(api POST /admin/v1/members/_search '{}' \
    | jq -r --arg u "$BOOTSTRAP_UID" '.result[]? | select(.userId==$u) | .roles[]' 2>/dev/null | sort -u)"
  if grep -qx "IAM_LOGIN_CLIENT" <<< "$EXISTING_ROLES"; then
    echo "IAM_LOGIN_CLIENT already granted to ${BOOTSTRAP_USERNAME}" >&2
  else
    ROLES_JSON="$(printf '%s\nIAM_LOGIN_CLIENT\n' "$EXISTING_ROLES" \
      | grep -v '^$' | sort -u | jq -R . | jq -sc .)"
    api_idempotent PUT "/admin/v1/members/${BOOTSTRAP_UID}" \
      "$(jq -nc --argjson r "$ROLES_JSON" '{roles:$r}')" >/dev/null \
      && echo "granted IAM_LOGIN_CLIENT to ${BOOTSTRAP_USERNAME}" >&2
  fi
else
  echo "WARN: machine user ${BOOTSTRAP_USERNAME} not found; cannot grant" >&2
  echo "      IAM_LOGIN_CLIENT — the EARS-8 session-link will 403 until it is" >&2
  echo "      granted (set IDP_BOOTSTRAP_USERNAME if the PAT user differs)." >&2
fi

# ── 6. converge SMTP provider → Mailpit (dev) | real transactional sender ────
# Email verification (EARS-3) and password-reset codes are delivered by Zitadel's
# SMTP notifier. Zitadel ships with NO SMTP provider, so `email/resend` accepts
# (200) yet nothing is delivered until one is configured + activated (the live
# email-verify round-trip #148 depends on it). EMAIL_DELIVERY_MODE selects the
# target and this step CONVERGES the active provider to it on every run (so a
# mode flip actually re-points delivery — a create-if-absent step never could):
#   mailpit → host `mailpit:1025` (in-network service name, NOT the host port),
#             TLS off, no auth — the plaintext dev catch-all (current default).
#   real    → the real transactional sender from env (TLS on, SMTP AUTH). Fails
#             with a clear message if any required real-SMTP var is unset — we do
#             NOT silently fall back to Mailpit (that would mask a misconfigured
#             paid path), and no real cred is ever committed.
# Convergence uses the update API `PUT /admin/v1/smtp/{id}` (the create endpoint
# is `POST /admin/v1/smtp`; payload shape is identical), then (re)activates so
# the converged provider is the active one. Idempotent: a re-run in the same mode
# yields Zitadel's "No changes" 400, swallowed by api_idempotent.
if [[ "$EMAIL_DELIVERY_MODE" == "real" ]]; then
  # Real transactional sender — every value from env, none defaulted/committed.
  SMTP_HOST_PORT="${IDP_SMTP_REAL_HOST:-}"
  # Allow either a combined host:port (IDP_SMTP_REAL_HOST="smtp.example.com:587")
  # or a separate IDP_SMTP_REAL_PORT joined onto a bare host.
  if [[ -n "$SMTP_HOST_PORT" && "$SMTP_HOST_PORT" != *:* && -n "${IDP_SMTP_REAL_PORT:-}" ]]; then
    SMTP_HOST_PORT="${SMTP_HOST_PORT}:${IDP_SMTP_REAL_PORT}"
  fi
  SMTP_USER="${IDP_SMTP_REAL_USER:-}"
  SMTP_PASSWORD="${IDP_SMTP_REAL_PASSWORD:-}"
  SMTP_SENDER_ADDRESS="${IDP_SMTP_REAL_SENDER_ADDRESS:-}"
  SMTP_SENDER_NAME="${IDP_SMTP_REAL_SENDER_NAME:-DS Platform}"
  SMTP_TLS=true
  SMTP_DESC="real transactional sender"
  # Fail closed: a `real` selection with missing creds must be loud, never a
  # silent Mailpit fallback.
  _missing=""
  [[ -z "$SMTP_HOST_PORT" ]] && _missing+=" IDP_SMTP_REAL_HOST(+IDP_SMTP_REAL_PORT)" || true
  [[ -z "$SMTP_USER" ]] && _missing+=" IDP_SMTP_REAL_USER" || true
  [[ -z "$SMTP_PASSWORD" ]] && _missing+=" IDP_SMTP_REAL_PASSWORD" || true
  [[ -z "$SMTP_SENDER_ADDRESS" ]] && _missing+=" IDP_SMTP_REAL_SENDER_ADDRESS" || true
  if [[ -n "$_missing" ]]; then
    echo "EMAIL_DELIVERY_MODE=real but missing required env:${_missing}" >&2
    echo "  set them in .env.local (see .env.example) or use EMAIL_DELIVERY_MODE=mailpit" >&2
    exit 4
  fi
else
  # Mailpit (default) — plaintext dev catch-all, no auth.
  SMTP_HOST_PORT="${IDP_SMTP_HOST:-mailpit:1025}"
  SMTP_USER=""
  SMTP_PASSWORD=""
  SMTP_SENDER_ADDRESS="${IDP_SMTP_SENDER_ADDRESS:-no-reply@ds.test}"
  SMTP_SENDER_NAME="${IDP_SMTP_SENDER_NAME:-DS Platform Dev}"
  SMTP_TLS=false
  SMTP_DESC="dev-stand mailpit"
fi

SMTP_PAYLOAD="$(jq -nc \
  --arg d "$SMTP_DESC" \
  --arg h "$SMTP_HOST_PORT" \
  --arg a "$SMTP_SENDER_ADDRESS" \
  --arg n "$SMTP_SENDER_NAME" \
  --arg u "$SMTP_USER" \
  --arg p "$SMTP_PASSWORD" \
  --argjson tls "$SMTP_TLS" \
  '{description:$d, senderAddress:$a, senderName:$n, tls:$tls, host:$h, user:$u, password:$p}')"

EXISTING_SMTP="$(api POST /admin/v1/smtp/_search '{}' \
  | jq -r '.result[]?.id' | head -n1 || true)"
if [[ -n "$EXISTING_SMTP" && "$EXISTING_SMTP" != "null" ]]; then
  # Converge the existing provider to the selected mode, then (re)activate it.
  api_idempotent PUT "/admin/v1/smtp/${EXISTING_SMTP}" "$SMTP_PAYLOAD" >/dev/null
  # api_activate (not api_idempotent): a same-mode re-run finds the provider
  # already active, which Zitadel rejects with a precondition error, not "No
  # changes" — tolerate it so the re-run converges to a no-op.
  api_activate POST "/admin/v1/smtp/${EXISTING_SMTP}/_activate" '{}' >/dev/null
  echo "converged SMTP provider ${EXISTING_SMTP} -> ${SMTP_DESC} (${SMTP_HOST_PORT})" >&2
else
  SMTP_ID="$(api POST /admin/v1/smtp "$SMTP_PAYLOAD" | jq -r '.id')"
  api POST "/admin/v1/smtp/${SMTP_ID}/_activate" '{}' >/dev/null
  echo "created + activated SMTP provider ${SMTP_ID} -> ${SMTP_DESC} (${SMTP_HOST_PORT})" >&2
fi

# ── 7. converge HTTP SMS provider → sms-sink (dev) | sms-aero-adapter (real) ──
# SMS-OTP login (EARS-7) and phone verification (EARS-13) deliver their codes via
# Zitadel's SMS notifier — and Zitadel ships with NO SMS provider, so the
# `otpSms` session challenge / `phone/resend` accept (200) yet nothing is
# delivered until a generic HTTP SMS provider is configured + activated (the live
# SMS-OTP round-trip #170, zitadel-otp-login.e2e-spec EARS-7 + the portal sms-OTP
# browser journey depend on it). SMS_DELIVERY_MODE selects the webhook target and
# this step CONVERGES the active provider's endpoint to it on every run:
#   sink → `http://sms-sink:8090/` — the dev SMS catch-all (the SMS analogue of
#          Mailpit, compose.core.yml). The sink stores each webhook body so the
#          live e2e reads the delivered code back by recipient phone (no
#          `returnCode` leak, no test backdoor — AGENTS.md §6). Default.
#   real → `http://sms-aero-adapter:8091/` — the adapter that forwards to SMS-Aero
#          (smsaero.ru Gate API v2), the PRODUCTION sender recorded in the specs
#          (engineering-readiness §5.bis, identity-auth-rbac-design §5, ADR-0001
#          design). Real SMS COSTS MONEY — opt-in, OFF by default (#176).
# Both targets are in-network service names, NOT a real gateway reached from
# Zitadel directly (the adapter holds the SMS-Aero creds + does the egress).
# Override the endpoint explicitly with IDP_SMS_HTTP_ENDPOINT. Convergence uses
# the update API `PUT /admin/v1/sms/{id}/http` (create is `POST /admin/v1/sms/http`),
# then (re)activates. Idempotent: a re-run in the same mode yields "No changes".
if [[ "$SMS_DELIVERY_MODE" == "real" ]]; then
  SMS_DEFAULT_ENDPOINT="http://sms-aero-adapter:8091/"
  SMS_DESC="real sms-aero-adapter"
else
  SMS_DEFAULT_ENDPOINT="http://sms-sink:8090/"
  SMS_DESC="dev-stand sms-sink"
fi
SMS_ENDPOINT="${IDP_SMS_HTTP_ENDPOINT:-$SMS_DEFAULT_ENDPOINT}"
SMS_HTTP_PAYLOAD="$(jq -nc --arg e "$SMS_ENDPOINT" --arg d "$SMS_DESC" \
  '{endpoint:$e, description:$d}')"

EXISTING_SMS="$(api POST /admin/v1/sms/_search '{}' \
  | jq -r '.result[]?.id' | head -n1 || true)"
if [[ -n "$EXISTING_SMS" && "$EXISTING_SMS" != "null" ]]; then
  # Repoint the existing HTTP SMS provider to the selected target, then
  # (re)activate so the converged provider is the active one.
  api_idempotent PUT "/admin/v1/sms/${EXISTING_SMS}/http" "$SMS_HTTP_PAYLOAD" >/dev/null
  # api_activate (not api_idempotent): a same-mode re-run finds the provider
  # already active, which Zitadel rejects with a precondition error, not "No
  # changes" — tolerate it so the re-run converges to a no-op.
  api_activate POST "/admin/v1/sms/${EXISTING_SMS}/_activate" '{}' >/dev/null
  echo "converged HTTP SMS provider ${EXISTING_SMS} -> ${SMS_DESC} (${SMS_ENDPOINT})" >&2
else
  SMS_ID="$(api POST /admin/v1/sms/http "$SMS_HTTP_PAYLOAD" \
    | jq -r '.id // .details.id // empty')"
  if [[ -n "$SMS_ID" && "$SMS_ID" != "null" ]]; then
    api POST "/admin/v1/sms/${SMS_ID}/_activate" '{}' >/dev/null
    echo "created + activated HTTP SMS provider ${SMS_ID} -> ${SMS_DESC} (${SMS_ENDPOINT})" >&2
  else
    echo "WARN: HTTP SMS provider create returned no id; SMS-OTP (EARS-7) will" >&2
    echo "      not deliver until a provider is configured." >&2
  fi
fi

# ── output (machine-parseable; secret only when freshly created) ─────────────
echo "IDP_PROJECT_ID=${PROJECT_ID}"
echo "IDP_CLIENT_ID=${CLIENT_ID}"
if [[ -n "$CLIENT_SECRET" ]]; then
  echo "IDP_CLIENT_SECRET=${CLIENT_SECRET}"
else
  echo "# IDP_CLIENT_SECRET not re-emitted (app already existed); rotate via:" >&2
  echo "#   POST /management/v1/projects/${PROJECT_ID}/apps/${EXISTING_APP:-<appId>}/oidc_config/_generate_client_secret" >&2
fi

# Echo the redirect URIs actually registered on the app so IDP_REDIRECT_URI is
# discoverable on every (re)provision — the BFF must echo a byte-matching value at
# the token exchange or Zitadel's authorize returns 400 (#159). The api/portal run
# on the dev machine, so these are localhost callbacks regardless of where Zitadel
# itself runs (the IDP_ISSUER HOST). The api BFF callback (:3000) is the canonical
# IDP_REDIRECT_URI; the portal (:3100) uses its own.
echo "# registered redirect URIs (set IDP_REDIRECT_URI to the api BFF :3000 callback):" >&2
echo "$REDIRECT_JSON" | jq -r '.[]' | while IFS= read -r _uri; do
  echo "#   ${_uri}" >&2
done
echo "# IDP_REDIRECT_URI=$(echo "$REDIRECT_JSON" | jq -r '.[0]')" >&2
echo "# NOTE: a full @ds/api boot also needs AUDIT_IDENTIFIER_PEPPER in .env.local" >&2
echo "#   (fail-closed #141 gate; NOT a Zitadel artifact). Generate once + keep" >&2
echo "#   stable: openssl rand -hex 32. See .env.example / idp/bootstrap.md §4." >&2
