#!/usr/bin/env bash
# DS Platform — Zitadel OIDC application provisioner (idempotent, scriptable)
#
# Creates everything the api BFF needs to complete the OIDC login dance against
# the dev-stand Zitadel: a project, a web/OIDC application (authorization_code +
# refresh_token), redirect URIs for the api and portal, and the project-role
# claim assertion so `urn:zitadel:iam:org:project:roles` is emitted in the token
# (003 F2 parses it). It also seeds the `doctor_guest` and `platform_admin`
# project roles.
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
# Project roles to seed, comma-separated (the live BFF test asserts the roles
# claim is parsed). `doctor_guest` is the default registrant role; `platform_admin`
# is the admin role the 007 admin surface + admin E2E depend on (#662).
SEED_ROLE="${IDP_SEED_ROLE:-doctor_guest,platform_admin}"

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

# Locale-independent "converged precondition" detector. Zitadel localizes its
# error MESSAGES to the instance default language, so once step 8 flips that
# default to `ru` the "No changes"/"already active" preconditions come back in
# Russian ("Изменений не обнаружено", "Экземпляр не изменён", "уже активна") and
# any English-literal grep silently misses them — re-aborting an otherwise
# converged re-run under `set -euo pipefail`. The language-PROOF signals are the
# gRPC status `"code": 9` (FAILED_PRECONDITION — what EVERY no-change/already-
# active rejection is) and the stable error IDs in the `(CODE-xxxxx)` suffix,
# which Zitadel NEVER translates. We match those first, then keep the EN/RU text
# phrases as a readable fallback. Scoped to the idempotent converge helpers, where
# a precondition rejection IS the desired converged state. Reads /tmp/.idperr, the
# captured `API ... -> HTTP ...: {json}` line from api().
_is_converged_precondition() {
  grep -qE '"code"[[:space:]]*:[[:space:]]*9' /tmp/.idperr 2>/dev/null && return 0
  grep -qiE "no changes|already active|изменений не обнаружено|не изменён|уже активн" \
    /tmp/.idperr 2>/dev/null && return 0
  return 1
}

# Like api(), but treats Zitadel's "No changes" precondition as success — an
# idempotent update that finds nothing to change is the desired converged state,
# not a fail (locale-independent via _is_converged_precondition).
api_idempotent() {
  local out
  if out="$(api "$@" 2>/tmp/.idperr)"; then
    printf '%s' "$out"
    return 0
  fi
  if _is_converged_precondition; then
    echo "(already converged — no changes)" >&2
    return 0
  fi
  cat /tmp/.idperr >&2
  return 1
}

# Like api(), but for the SMTP/SMS provider `_activate` calls in the converge
# branches (steps 6/7). A freshly converged provider must be (re)activated, but
# on a SAME-MODE re-run the provider is ALREADY ACTIVE, and Zitadel rejects a
# redundant activation with a precondition error (gRPC code 9) whose wording is
# both version- AND locale-dependent (an "already active"-class message, NOT the
# literal "No changes"). One supervised same-mode re-run must converge to a no-op,
# not abort under `set -euo pipefail`, so this helper treats the no-change AND the
# already-active precondition as success via the shared locale-independent
# _is_converged_precondition (code-9 + stable ids, EN/RU text fallback). Scoped to
# the activate calls ONLY — the strict api_idempotent stays on the project/app/
# member PUTs so genuine errors there are never masked.
api_activate() {
  local out
  if out="$(api "$@" 2>/tmp/.idperr)"; then
    printf '%s' "$out"
    return 0
  fi
  if _is_converged_precondition; then
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

# ── 2. ensure seed project roles ─────────────────────────────────────────────
# Seeds ALL roles in the SEED_ROLE CSV (doctor_guest + platform_admin) — each is
# search-by-key/create-if-absent, so this loop is idempotent per role.
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

# ── 4. ensure Login V2 instance feature + baseUri (operator Console login, #174) ─
# The headless BFF session->token exchange (EARS-8) links a checked session to a
# pending OIDC auth request via POST /v2/oidc/auth_requests/{id}. That API only
# resolves an auth request CREATED UNDER LOGIN V2 — with the feature off the
# authorize hop files a v1 auth request the v2 API can't see (404 "Auth Request
# does not exist", proven live #146). compose.core.yml turns it on at instance
# init (ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED); this converges it on
# any instance initialised before that default (idempotent).
#
# baseUri (#174): the v2 authorize hop redirects the BROWSER to this URL to render
# the login UI. Setting it makes the admin Console (/ui/console) browsable — its
# interactive login now lands on the `idp-login` container served under
# /ui/v2/login at the SAME external origin (fronted by the idp-proxy Caddy). This
# is a DEV-OPERATOR CONVENIENCE only: the api BFF stays HEADLESS (Variant-B) and
# never renders this UI — its auth_requests + token endpoints are served by the
# core binary regardless of baseUri. baseUri derives from the provisioner's
# BASE_URL (the external origin) + the login app's base path, so it is the same
# origin the issuer/discovery use — no new input. Override via IDP_LOGIN_BASE_URI.
#
# Idempotency: a same-value PUT returns Zitadel's code-9 "no changes" precondition,
# which api_idempotent absorbs (locale-independent), so a re-run / dev:up converges.
LOGIN_BASE_URI="${IDP_LOGIN_BASE_URI:-${BASE_URL}/ui/v2/login}"
api_idempotent PUT /v2/features/instance \
  "$(jq -nc --arg u "$LOGIN_BASE_URI" '{loginV2:{required:true, baseUri:$u}}')" >/dev/null \
  && echo "loginV2 feature ensured (required, baseUri=${LOGIN_BASE_URI})" >&2

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

# ── 6. ensure BOTH SMTP providers → Mailpit (intercept) + real sender ────────
# Email verification (EARS-3) and password-reset codes are delivered by Zitadel's
# SMTP notifier. Zitadel ships with NO SMTP provider, so `email/resend` accepts
# (200) yet nothing is delivered until one is configured + activated (the live
# email-verify round-trip #148 depends on it).
#
# #185 (runtime delivery toggle): instead of converging to ONE provider, this step
# ensures BOTH the Mailpit (intercept) AND the real-sender provider EXIST, each
# stamped with a STABLE recognizable `description` the api matches on:
#   "dev-stand mailpit"          → host `mailpit:1025` (in-network service name,
#                                  NOT the host port), TLS off, no auth — the
#                                  plaintext dev catch-all.
#   "real transactional sender"  → the real sender from env (TLS on, SMTP AUTH),
#                                  configured ONLY when its creds (IDP_SMTP_REAL_*)
#                                  are present (else SKIPPED with a clear note —
#                                  you cannot test real email without creds anyway;
#                                  no real cred is ever committed).
# Activation is left to runtime: the api's delivery reconcile reads the Unleash
# `email-delivery-real` flag and `_activate`s the matching provider by description
# (no .env edit + restart). At boot we activate the one selected by EMAIL_DELIVERY_MODE
# so a stand without the api still has a working active provider (the bootstrap
# default). ensure_smtp_provider creates-or-updates by description; activation uses
# api_activate (tolerates the already-active precondition on a same-mode re-run).
#
# ensure_smtp_provider <description> <host:port> <senderAddr> <senderName> <user> <pw> <tls-bool>
#   echoes the provider id on stdout.
ensure_smtp_provider() {
  local desc="$1" host="$2" addr="$3" name="$4" user="$5" pw="$6" tls="$7" payload id
  payload="$(jq -nc --arg d "$desc" --arg h "$host" --arg a "$addr" \
    --arg n "$name" --arg u "$user" --arg p "$pw" --argjson tls "$tls" \
    '{description:$d, senderAddress:$a, senderName:$n, tls:$tls, host:$h, user:$u, password:$p}')"
  # Match an existing provider by its stable description (the #185 contract).
  id="$(api POST /admin/v1/smtp/_search '{}' \
    | jq -r --arg d "$desc" '.result[]? | select(.description==$d) | .id' | head -n1 || true)"
  if [[ -n "$id" && "$id" != "null" ]]; then
    api_idempotent PUT "/admin/v1/smtp/${id}" "$payload" >/dev/null
    echo "ensured SMTP provider ${id} (${desc})" >&2
  else
    id="$(api POST /admin/v1/smtp "$payload" | jq -r '.id')"
    echo "created SMTP provider ${id} (${desc})" >&2
  fi
  printf '%s' "$id"
}

# Mailpit (intercept) — always ensured.
SMTP_MAILPIT_ID="$(ensure_smtp_provider \
  "dev-stand mailpit" \
  "${IDP_SMTP_HOST:-mailpit:1025}" \
  "${IDP_SMTP_SENDER_ADDRESS:-no-reply@ds.test}" \
  "${IDP_SMTP_SENDER_NAME:-DS Platform Dev}" \
  "" "" false)"

# Real transactional sender — ensured ONLY when its creds are present. Missing
# creds is NOT fatal here (unlike the old converge-to-real path): the intercept
# provider stands, the real one is simply absent, and the api reconcile will skip
# `email-delivery-real` with a clear note (you cannot test real email without creds).
SMTP_REAL_ID=""
SMTP_REAL_HOST_PORT="${IDP_SMTP_REAL_HOST:-}"
if [[ -n "$SMTP_REAL_HOST_PORT" && "$SMTP_REAL_HOST_PORT" != *:* && -n "${IDP_SMTP_REAL_PORT:-}" ]]; then
  SMTP_REAL_HOST_PORT="${SMTP_REAL_HOST_PORT}:${IDP_SMTP_REAL_PORT}"
fi
if [[ -n "$SMTP_REAL_HOST_PORT" && -n "${IDP_SMTP_REAL_USER:-}" \
   && -n "${IDP_SMTP_REAL_PASSWORD:-}" && -n "${IDP_SMTP_REAL_SENDER_ADDRESS:-}" ]]; then
  SMTP_REAL_ID="$(ensure_smtp_provider \
    "real transactional sender" \
    "$SMTP_REAL_HOST_PORT" \
    "${IDP_SMTP_REAL_SENDER_ADDRESS}" \
    "${IDP_SMTP_REAL_SENDER_NAME:-DS Platform}" \
    "${IDP_SMTP_REAL_USER}" \
    "${IDP_SMTP_REAL_PASSWORD}" \
    true)"
else
  echo "real SMTP creds (IDP_SMTP_REAL_*) absent — skipping the real SMTP provider." >&2
  echo "  'email-delivery-real' will have no provider to activate; the api reconcile" >&2
  echo "  leaves email on Mailpit and warns. Set IDP_SMTP_REAL_* to enable real email." >&2
fi

# Activate the boot-time default (EMAIL_DELIVERY_MODE) so a stand has a working
# active SMTP provider even before the api reconcile runs. If `real` is requested
# but its provider was skipped (no creds), fall back to Mailpit with a loud note —
# a `real` boot default with no creds must not leave delivery unconfigured.
if [[ "$EMAIL_DELIVERY_MODE" == "real" && -n "$SMTP_REAL_ID" ]]; then
  api_activate POST "/admin/v1/smtp/${SMTP_REAL_ID}/_activate" '{}' >/dev/null
  echo "activated SMTP provider ${SMTP_REAL_ID} (real transactional sender) [boot default]" >&2
else
  if [[ "$EMAIL_DELIVERY_MODE" == "real" ]]; then
    echo "WARN: EMAIL_DELIVERY_MODE=real but no real SMTP provider (creds absent) —" >&2
    echo "      activating Mailpit instead. Set IDP_SMTP_REAL_* or use mailpit." >&2
  fi
  api_activate POST "/admin/v1/smtp/${SMTP_MAILPIT_ID}/_activate" '{}' >/dev/null
  echo "activated SMTP provider ${SMTP_MAILPIT_ID} (dev-stand mailpit) [boot default]" >&2
fi

# ── 7. ensure BOTH HTTP SMS providers → sms-sink (intercept) + sms-aero (real) ─
# SMS-OTP login (EARS-7) and phone verification (EARS-13) deliver their codes via
# Zitadel's SMS notifier — and Zitadel ships with NO SMS provider, so the
# `otpSms` session challenge / `phone/resend` accept (200) yet nothing is
# delivered until a generic HTTP SMS provider is configured + activated (the live
# SMS-OTP round-trip #170, zitadel-otp-login.e2e-spec EARS-7 + the portal sms-OTP
# browser journey depend on it).
#
# #185 (runtime delivery toggle): both SMS providers are HTTP providers with
# STATIC in-network endpoints, so this step ensures BOTH EXIST (no creds gate —
# unlike SMTP, neither endpoint needs a secret here; the sms-aero-adapter holds
# the SMS-Aero creds and does the egress), each stamped with a STABLE description:
#   "dev-stand sms-sink"      → `http://sms-sink:8090/` — the dev SMS catch-all
#                               (the SMS analogue of Mailpit, compose.core.yml).
#                               The sink stores each webhook body so the live e2e
#                               reads the delivered code back by recipient phone
#                               (no `returnCode` leak, no test backdoor — AGENTS.md §6).
#   "real sms-aero-adapter"   → `http://sms-aero-adapter:8091/` — the adapter that
#                               forwards to SMS-Aero (smsaero.ru Gate API v2), the
#                               PRODUCTION sender. Real SMS COSTS MONEY — opt-in.
# Activation is left to runtime: the api's delivery reconcile reads the Unleash
# `sms-delivery-real` flag and `_activate`s the matching provider by description.
# At boot we activate the one selected by SMS_DELIVERY_MODE (the bootstrap default).
#
# ensure_sms_provider <description> <endpoint> — echoes the provider id.
ensure_sms_provider() {
  local desc="$1" endpoint="$2" payload id
  payload="$(jq -nc --arg e "$endpoint" --arg d "$desc" '{endpoint:$e, description:$d}')"
  # The id lives on the provider root; the description may sit on the root or
  # nested under `.http` (Zitadel returns the HTTP provider object there). Match
  # on either, then read the sibling root `.id` (the #185 description contract).
  id="$(api POST /admin/v1/sms/_search '{}' \
    | jq -r --arg d "$desc" '.result[]? | select((.http.description // .description)==$d) | .id' \
    | head -n1 || true)"
  if [[ -n "$id" && "$id" != "null" ]]; then
    # Update verb is `PUT /admin/v1/sms/http/{id}` (id AFTER `http`); the
    # `/admin/v1/sms/{id}/http` spelling 404s on Zitadel v4 (proven live, #185).
    api_idempotent PUT "/admin/v1/sms/http/${id}" "$payload" >/dev/null
    echo "ensured HTTP SMS provider ${id} (${desc})" >&2
  else
    id="$(api POST /admin/v1/sms/http "$payload" | jq -r '.id // .details.id // empty')"
    echo "created HTTP SMS provider ${id} (${desc})" >&2
  fi
  printf '%s' "$id"
}

SMS_SINK_ID="$(ensure_sms_provider "dev-stand sms-sink" \
  "${IDP_SMS_SINK_ENDPOINT:-http://sms-sink:8090/}")"
SMS_AERO_ID="$(ensure_sms_provider "real sms-aero-adapter" \
  "${IDP_SMS_AERO_ENDPOINT:-http://sms-aero-adapter:8091/}")"

# Activate the boot-time default (SMS_DELIVERY_MODE) so a stand has a working
# active SMS provider even before the api reconcile runs.
if [[ "$SMS_DELIVERY_MODE" == "real" && -n "$SMS_AERO_ID" && "$SMS_AERO_ID" != "null" ]]; then
  api_activate POST "/admin/v1/sms/${SMS_AERO_ID}/_activate" '{}' >/dev/null
  echo "activated HTTP SMS provider ${SMS_AERO_ID} (real sms-aero-adapter) [boot default]" >&2
elif [[ -n "$SMS_SINK_ID" && "$SMS_SINK_ID" != "null" ]]; then
  api_activate POST "/admin/v1/sms/${SMS_SINK_ID}/_activate" '{}' >/dev/null
  echo "activated HTTP SMS provider ${SMS_SINK_ID} (dev-stand sms-sink) [boot default]" >&2
else
  echo "WARN: no HTTP SMS provider id to activate; SMS-OTP (EARS-7) will not deliver." >&2
fi

# ── 8. ensure notification language → ru (default + allowed-language lock, #177) ─
# Zitadel renders every notification (registration InitCode, email-verify,
# password-reset, and the email/SMS OTP texts) from its message-text templates,
# choosing the language by this precedence: the user's `preferredLanguage` →
# the triggering request's `Accept-Language` → the INSTANCE DEFAULT. The portal
# forms were already localized in #181, but these IdP-rendered bodies are out of
# next-intl's reach and arrived in English/other languages live — this step fixes
# that Zitadel-side, reproducibly.
#
# Zitadel ships built-in Russian translations for MOST of these message types
# (verified live: init/verifyemail/passwordreset/verifyphone/verifyemailotp all
# return good `ru` copy with the right {{.Code}}/{{.OTP}} placeholders), so those
# need NO custom override — we only have to make Zitadel SELECT Russian.
# `verifysmsotp` is the EXCEPTION (#226): its bundled default is inadequate —
# it leaks OTP-jargon ("OTP"), the dev domain ({{.Domain}} -> truenas.local), the
# raw Go-duration {{.Expiry}} (e.g. "5m0s"), and a WebOTP autofill line
# (`@{{.Domain}} #{{.OTP}}`), and the idp even warns `VerifySMSOTP.Title not found
# in language "ru"`. We therefore explicitly override `verifysmsotp` (ru + en) with
# branded Doctor.School copy in step 8.bis below. (If any of the bundled copy ever
# regresses, converge per-type custom texts via PUT
# /admin/v1/text/message/{type}/ru — init|verifyemail|verifyphone|passwordreset|
# verifyemailotp|verifysmsotp.)
#
# TWO levers, because the instance default alone is NOT sufficient (proven live):
#   (a) Default language → ru. The documented fallback. Necessary, but registrants
#       created by the BFF carry no `preferredLanguage`, and the default is only a
#       LAST resort — when a request carries any other resolvable language the
#       default loses, and on this stand the pure-default path resolved to random
#       languages (Polish/Turkish/Hungarian across identical requests), NOT ru.
#   (b) Allowed-languages restriction → [ru]. The DETERMINISTIC lever. Zitadel
#       renders notification (and login-UI) texts ONLY in allowed languages, so
#       restricting the instance to `ru` collapses every non-ru negotiation onto
#       Russian. Verified live: three pure-default-path registrations all rendered
#       Russian once `allowedLanguages=[ru]`. This is the product reality for a
#       Russian-only audience — and it keeps the fix entirely Zitadel-side (no BFF
#       per-user `preferredLanguage` plumbing required). A restricted instance also
#       means the default MUST be in the allowed set, which is why (a) precedes (b):
#       setting the default to `ru` first guarantees `ru` is a valid default before
#       (b) locks the allowed set to `[ru]`.
#       NOTE ON ORDERING: (a)'s `PUT default/ru` only succeeds when the instance's
#       CURRENT allowed set already includes `ru`. That holds for a fresh/unrestricted
#       instance, and for one already including `ru` in its allowed set (which this
#       script guarantees on every prior run, since (b) locks to `[ru]`). It does NOT
#       hold for an instance pre-restricted out-of-band to a `ru`-less set (e.g.
#       `[en]`): there (a) would be rejected and, running under `set -e`, would wedge
#       this step. provision.sh never creates that state itself, so it is not a real
#       failure path here — but the ordering is NOT a "converges from any state"
#       guarantee, only a "fresh/unrestricted-or-already-includes-ru" one.
# Override the locale via IDP_NOTIFICATION_LANGUAGE. Lever (b) is ON by default
# (unset → locked to [ru]); a truthy IDP_RESTRICT_LANGUAGES (1/true/yes/on, case-
# insensitive) keeps it on, any other value (e.g. 0/false) skips lever (b) for a
# multi-locale instance and relies on the default + the BFF stamping
# `preferredLanguage` instead.
#
# Idempotency: re-setting the SAME default / restriction returns a precondition
# 400 ("Instance not changed" INST-DS3rq) which — once the default IS ru — Zitadel
# LOCALIZES to Russian, defeating any English-literal "No changes" grep. We
# therefore read-before-write (the step-2/5 precedent): GET current state and PUT
# only on a real delta. A second run finds ru already set/allowed and no-ops.
NOTIF_LANG="${IDP_NOTIFICATION_LANGUAGE:-ru}"
# Lock allowed languages to [ru] by default (unset → enabled). Accept common truthy
# spellings (1/true/yes/on, case-insensitive) as "enable the lock"; any other value
# is an explicit opt-out. The default stays enabled.
RESTRICT_LANGS="${IDP_RESTRICT_LANGUAGES:-1}"
case "$(printf '%s' "$RESTRICT_LANGS" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) RESTRICT_LANGS=1 ;;
  *)             RESTRICT_LANGS=0 ;;
esac
SUPPORTED_LANGS="$(api GET /admin/v1/languages | jq -r '.languages[]?' 2>/dev/null)"
if ! grep -qx "$NOTIF_LANG" <<< "$SUPPORTED_LANGS"; then
  echo "WARN: '${NOTIF_LANG}' is not a Zitadel-supported language; skipping notification-" >&2
  echo "      language convergence. Notifications stay in the current language." >&2
else
  # (a) default language
  CURRENT_DEFAULT_LANG="$(api GET /admin/v1/languages/default | jq -r '.language // empty')"
  if [[ "$CURRENT_DEFAULT_LANG" == "$NOTIF_LANG" ]]; then
    echo "instance default language already ${NOTIF_LANG}" >&2
  else
    api PUT "/admin/v1/languages/default/${NOTIF_LANG}" '{}' >/dev/null \
      && echo "set instance default language ${CURRENT_DEFAULT_LANG:-<unset>} -> ${NOTIF_LANG}" >&2
  fi
  # (b) allowed-languages restriction (the deterministic lock)
  if [[ "$RESTRICT_LANGS" == "1" ]]; then
    CURRENT_ALLOWED="$(api GET /admin/v1/restrictions | jq -rc '.allowedLanguages // [] | sort')"
    if [[ "$CURRENT_ALLOWED" == "$(jq -nc --arg l "$NOTIF_LANG" '[$l]')" ]]; then
      echo "allowed languages already locked to [${NOTIF_LANG}]" >&2
    else
      api PUT /admin/v1/restrictions \
        "$(jq -nc --arg l "$NOTIF_LANG" '{allowedLanguages:{list:[$l]}}')" >/dev/null \
        && echo "locked allowed languages -> [${NOTIF_LANG}] (notifications deterministic)" >&2
    fi
  else
    echo "IDP_RESTRICT_LANGUAGES=0 — leaving allowed languages unrestricted (default-only)" >&2
  fi
fi

# ── 8.bis. brand the SMS OTP message text (verifysmsotp ru+en) ───────────────
# Branded SMS OTP copy (#226): the bundled verifysmsotp default leaks OTP-jargon,
# the dev domain, the raw {{.Expiry}}, and a WebOTP autofill line. {{.OTP}} is the
# Zitadel code variable for this type (verified live). Placed AFTER step 8 so the
# language lock is already set. Idempotent: a same-text re-run returns a code-9
# "No changes" precondition, which api_idempotent absorbs.
#
# ONLY `text` is customizable for verifysmsotp: per Zitadel source
# `internal/notification/static/i18n/{ru,en}.yaml`, the i18n bundle defines just the
# `Text` field for VerifySMSOTP in EVERY language — the other fields are email-only.
# The message-text API persists ONLY `text` for this SMS type; a PUT of
# title/subject/etc. is silently dropped (GET returns them null). Keep {{.OTP}} —
# do NOT "fix" it to {{.Code}} (some docs cite {{.Code}}; it is wrong for this type).
#
# KNOWN BENIGN: each SMS OTP send logs 6 warnings
#   `VerifySMSOTP.<field> not found in language "ru"`
# for Title/PreHeader/Subject/Greeting/ButtonText/Footer (email-template label fields
# that don't exist for the SMS type). They are NOT ru-specific (en warns identically),
# NOT caused by this branding (the bundled default warns the same), and NOT removable
# via the message-text API (the SMS type persists only `text`). Upstream Zitadel bug
# https://github.com/zitadel/zitadel/issues/9636 — in v2.71.4 the missing translation
# BLOCKED the SMS send (login broken); closed/Done by downgrading it to a non-blocking
# warning. On our v4.15.0 the SMS sends fine; this is cosmetic log noise only.
# Optional log-cleanup tracked in #230.
RU_SMS_OTP_TEXT='Doctor.School: код для входа - {{.OTP}}, никому его не сообщайте'
EN_SMS_OTP_TEXT='Doctor.School: your sign-in code is {{.OTP}}, do not share it with anyone'
api_idempotent PUT /admin/v1/text/message/verifysmsotp/ru \
  "$(jq -nc --arg t "$RU_SMS_OTP_TEXT" '{text:$t}')" >/dev/null \
  && echo "ensured verifysmsotp/ru branded SMS OTP text" >&2
api_idempotent PUT /admin/v1/text/message/verifysmsotp/en \
  "$(jq -nc --arg t "$EN_SMS_OTP_TEXT" '{text:$t}')" >/dev/null \
  && echo "ensured verifysmsotp/en branded SMS OTP text" >&2

# ── 8.ter. brand the registration verification email — CODE-ONLY (verifyemail ru+en, #869) ─
# The bundled verifyemail default renders a CTA button whose URL is Zitadel's
# hosted login-v2 UI — a dead end for portal registrants (#869) — and ANY
# GET-consumed link in this mail is scanner bait: mail.ru's `checklink` AV
# prefetch GETs every URL in a delivered mail, so a code-consuming link is burned
# before the human ever clicks (the owner's Stage-A verdict on #869 rejected the
# deep-link CTA for exactly this). The verification email is therefore CODE-ONLY:
# branded RU copy + the {{.Code}} the registrant TYPES on the portal /verify
# screen (where the #175 auto-login replay signs them in). Nothing in the mail is
# consumed on GET.
#
# BUTTONLESS: NO — verified live on v4.15.0. Overriding `buttonText` to the empty
# string does NOT suppress the CTA: an empty custom field falls through to the
# bundled default label («Подтвердить email»), and the button row + its URL render
# unconditionally. The URL itself is not a message-text field at all — it comes
# from the SEND request, so the BFF sets `SendEmailVerificationCode.urlTemplate`
# to the BARE portal `/verify` (no code/userId params — nothing consumed on GET;
# `apps/api` ZitadelIdpClient#emailSendCodeBody, #869) and this override demotes
# the button label to a subordinate navigation aid for the fallback button.
#
# Copy checklist (owner research + Stage-B verdict, #869): subject < 50 chars
# with the code early (rendered ~40 chars); the code renders as ONE unbroken
# token ({{.Code}} raw) — the Stage-B rework dropped the earlier {{slice}} triad
# grouping, whose rendered space contradicted the "type it exactly" instruction
# (owner feedback 2026-07-14, issue #869); readability comes from the enlarged
# letter-spaced span instead. Explicit expiry line (the instance's
# VERIFY_EMAIL_CODE secret-generator lifetime is 3600s — admin API
# `secretgenerators`, verified live); an explicit "if you didn't register,
# ignore this email" line. Markup:
# custom `text` is injected UNESCAPED into Zitadel's bundled table-layout/
# inline-CSS MJML template (mail.ru/Yandex-safe), so <br>/<strong>/inline-style
# spans render as HTML (verified live; the text/plain part degrades them sanely) —
# literal newlines do NOT survive (the div collapses whitespace), so paragraph
# breaks MUST be <br>.
#
# The subject deliberately leads with the code (inbox-preview UX). The e2e specs
# select this mail by the STABLE subject tail — `NOTIFICATION_SUBJECTS.verifyEmail`
# in apps/{api,portal} e2e support matches by substring — so a copy change here
# must keep that tail (or update both constants in the same PR).
RU_VERIFY_EMAIL_SUBJECT='{{.Code}} — код подтверждения Doctor.School'
RU_VERIFY_EMAIL_TITLE='Подтверждение email'
RU_VERIFY_EMAIL_PREHEADER='Введите код на странице подтверждения Doctor.School'
RU_VERIFY_EMAIL_GREETING='Здравствуйте!'
RU_VERIFY_EMAIL_TEXT='Ваш код подтверждения email на Doctor.School:<br><br><span style="font-size:28px;letter-spacing:3px"><strong>{{.Code}}</strong></span><br><br>Введите его на странице подтверждения, с которой вы регистрировались. Код действует 1 час.<br><br>Если вы не регистрировались на Doctor.School — проигнорируйте это письмо.'
RU_VERIFY_EMAIL_BUTTON='Открыть страницу подтверждения'
EN_VERIFY_EMAIL_SUBJECT='{{.Code}} — Doctor.School verification code'
EN_VERIFY_EMAIL_TITLE='Email verification'
EN_VERIFY_EMAIL_PREHEADER='Enter the code on the Doctor.School verification page'
EN_VERIFY_EMAIL_GREETING='Hello!'
EN_VERIFY_EMAIL_TEXT='Your Doctor.School email verification code:<br><br><span style="font-size:28px;letter-spacing:3px"><strong>{{.Code}}</strong></span><br><br>Enter it on the verification page you signed up from. The code is valid for 1 hour.<br><br>If you did not sign up for Doctor.School, please ignore this email.'
EN_VERIFY_EMAIL_BUTTON='Open the verification page'
api_idempotent PUT /admin/v1/text/message/verifyemail/ru \
  "$(jq -nc --arg s "$RU_VERIFY_EMAIL_SUBJECT" --arg ti "$RU_VERIFY_EMAIL_TITLE" \
        --arg p "$RU_VERIFY_EMAIL_PREHEADER" --arg g "$RU_VERIFY_EMAIL_GREETING" \
        --arg t "$RU_VERIFY_EMAIL_TEXT" --arg b "$RU_VERIFY_EMAIL_BUTTON" \
        '{subject:$s, title:$ti, preHeader:$p, greeting:$g, text:$t, buttonText:$b}')" >/dev/null \
  && echo "ensured verifyemail/ru code-only branded verification email" >&2
api_idempotent PUT /admin/v1/text/message/verifyemail/en \
  "$(jq -nc --arg s "$EN_VERIFY_EMAIL_SUBJECT" --arg ti "$EN_VERIFY_EMAIL_TITLE" \
        --arg p "$EN_VERIFY_EMAIL_PREHEADER" --arg g "$EN_VERIFY_EMAIL_GREETING" \
        --arg t "$EN_VERIFY_EMAIL_TEXT" --arg b "$EN_VERIFY_EMAIL_BUTTON" \
        '{subject:$s, title:$ti, preHeader:$p, greeting:$g, text:$t, buttonText:$b}')" >/dev/null \
  && echo "ensured verifyemail/en code-only branded verification email" >&2

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
