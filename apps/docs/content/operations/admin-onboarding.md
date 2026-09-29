---
title: "Onboard a staff member as Academy admin"
description: "End-to-end procedure for giving a staff member access to the Academy admin panel: find or create their Zitadel account, set a password, grant platform_admin, deliver the credentials by a Mattermost bot DM, the first login, and offboarding."
lang: en
---

# Onboard a staff member as Academy admin

A standalone procedure for the operator (the **Tech Lead / System Architect** in
Phase 0) who has been asked to give a staff member access to the Academy admin
panel at `https://admin.doctor.school`. It covers the whole path: account in
Zitadel (`https://id.doctor.school`), password, project-role grant, credential
delivery, the person's first login and — as the inverse — offboarding.

Roles, not names: this runbook never names a person. Placeholders are written
as `<placeholder>`; never paste a real password, token or PAT into this document,
a PR, an Issue, a chat or an agent transcript.

Related: the `platform_admin` grant snippet in `infra/deploy/README.md` (IdP
section, «Operator access to the product admin app») and the
[auth operations runbook](./auth-operations.md) — especially
[Admin locked out of the admin panel](./auth-operations.md#admin-locked-out-of-the-admin-panel).

## When to use / prerequisites

- **Owner decision first.** Onboarding grants the full `platform_admin` project
  role — the admin panel authorizes on that role. There is **no narrower
  events-only role**: `event-registrar` (044 EARS-17) authorizes the congress
  roster surface only, per event, and is not a substitute. The owner must have
  decided that this person gets full admin access.
- **Inputs:** the person's corporate email, first and last name (Zitadel
  requires both), their Mattermost account on `https://chat.bbm.academy`, and a
  one-phrase description of the work they are being onboarded for (used in the
  greeting).
- **Access you need** (workstation ssh aliases):
  - `ds-api-prod` — `deploy@77.233.220.222`, key `~/.ssh/ds-api-prod`; sudo is
    needed to read the bootstrap PAT and `api.env`.
  - `ds-data-prod` — `deploy@192.168.0.10`, key `~/.ssh/ds-data-prod`,
    `ProxyJump ds-api-prod` (offboarding only).
  - `tools-prod-tw` — the Mattermost box (bbm-owned infra, compose dir
    `~/mattermost-deploy`).
- **Why the operator creates the account:** public self-registration on
  `id.doctor.school` is DISABLED (login-policy posture in
  `infra/deploy/README.md`), so staff accounts are created by the operator.

## Workstation setup

Keep every scratch file in one private directory and never print a secret to
the terminal:

```bash
umask 077
W=$(mktemp -d)        # scratch dir for this onboarding; removed at the end
```

**Running a step script on a remote box.** Plain `ssh host bash -s < file` loses
stdin to inner commands (`sudo`, `curl`), and `bash -c "$script"` would put the
script text — a password included — into the process argv. Instead, the helper
below writes the script to a private temp file on the remote box, runs it with
stdin closed and deletes it:

```bash
run_remote() {
  ssh "$1" 'umask 077; f=$(mktemp); cat > "$f"; bash "$f" </dev/null; rc=$?; rm -f "$f"; exit $rc'
}
# usage: run_remote ds-api-prod < "$W/step1.sh"
```

**Every api-prod step script is a separate ssh run** — nothing carries over
between steps. Each script therefore starts with this preamble and sets the ids
it needs explicitly (copied from the previous step's output):

```bash
set -euo pipefail
B=https://id.doctor.school
EMAIL='<email>'
# Auth header lives in a private file, not in curl's argv (argv is readable
# via /proc while the call runs). The bootstrap PAT never leaves api-prod.
H=$(mktemp); trap 'rm -f "$H"' EXIT
printf 'Authorization: Bearer %s\nContent-Type: application/json\n' \
  "$(sudo cat /etc/ds-platform/idp-bootstrap-pat.txt)" > "$H"
```

Request bodies go over stdin (`--data-binary @-`), never in argv.

## Steps

### 1. Look up the person

`$W/step1.sh` = preamble +:

```bash
curl -sS -X POST "$B/management/v1/users/_search" -H @"$H" --data-binary @- <<EOF
{"queries":[{"emailQuery":{"emailAddress":"$EMAIL","method":"TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE"}}]}
EOF
```

Run: `run_remote ds-api-prod < "$W/step1.sh"`. `result[].id` is the user id. An
empty (or absent) `result` means there is no account — go to step 3. If the
account exists, skip step 3, note its id as `<user_id>`, and decide with the
person whether to set a new password (step 4) or let them keep their current
one.

### 2. Resolve the project and organization ids

Do not hardcode either id; read them each time. `$W/step2.sh` = preamble +:

```bash
# OIDC project id — grep the single key; do NOT `source` api.env
# (a value in it currently breaks shell sourcing). -f2- keeps any '=' in the value.
echo "project=$(sudo grep '^IDP_PROJECT_ID=' /etc/ds-platform/api.env | cut -d= -f2-)"

# Organization = the bootstrap PAT's own org
# (same rule as tools/staging/idp.mjs resolveOrgId).
curl -sS "$B/auth/v1/users/me" -H @"$H" \
  | python3 -c 'import sys,json; print("org=" + json.load(sys.stdin)["user"]["details"]["resourceOwner"])'
```

Note both values as `<project_id>` and `<org_id>` (ids, not secrets).

### 3. Create the human user

Only when step 1 found no account. `$W/step3.sh` = preamble +:

```bash
ORG_ID='<org_id>'
curl -sS -X POST "$B/v2/users/new" -H @"$H" --data-binary @- <<EOF
{"organizationId":"$ORG_ID","username":"$EMAIL","human":{"profile":{"givenName":"<first>","familyName":"<last>"},"email":{"email":"$EMAIL","isVerified":true}}}
EOF
```

Note the response field `id` (not `userId`) as `<user_id>`. `givenName` and
`familyName` are required by Zitadel. `isVerified: true` because the operator
vouches for the corporate address — no verification mail is sent.

### 4. Set and verify the password

Generate the password on the workstation straight into the scratch dir — 16
characters, upper + lower + digit + exactly one symbol from `-_!@#%`, no
ambiguous characters (`0 O o 1 l I`), never starting or ending with the symbol.
Do not print it:

```bash
python3 - <<'EOF' > "$W/pw.txt"
import secrets, string
amb = set("0Oo1lI")
alpha = [c for c in string.ascii_letters + string.digits if c not in amb]
while True:
    body = [secrets.choice(alpha) for _ in range(15)]
    body.insert(secrets.randbelow(14) + 1, secrets.choice("-_!@#%"))
    pw = "".join(body)
    if any(c.isupper() for c in pw) and any(c.islower() for c in pw) and any(c.isdigit() for c in pw):
        print(pw); break
EOF
```

`$W/step4.sh` = preamble +:

```bash
USER_ID='<user_id>'
# PW is prepended to this script by the run command below — never typed or printed.
curl -sS -X POST "$B/v2/users/$USER_ID/password" -H @"$H" --data-binary @- <<EOF
{"newPassword":{"password":"$PW","changeRequired":false}}
EOF

# Verify with a throwaway session, then delete it.
SID=$(curl -sS -X POST "$B/v2/sessions" -H @"$H" --data-binary @- <<EOF | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sessionId",""))'
{"checks":{"user":{"loginName":"$EMAIL"},"password":{"password":"$PW"}}}
EOF
)
if [ -n "$SID" ]; then
  echo "password verified"
  curl -sS -X DELETE "$B/v2/sessions/$SID" -H @"$H" --data-binary '{}'
else
  echo "password NOT verified — stop and investigate" >&2; exit 1
fi
```

Run it with the password prepended from the file (`printf` is a shell builtin,
so the value never appears in any process argv or on screen):

```bash
{ printf 'PW=%q\n' "$(cat "$W/pw.txt")"; cat "$W/step4.sh"; } | run_remote ds-api-prod
```

`changeRequired: false` because the admin login surface has no forced-change
step — a forced change would leave the person stuck.

### 5. Grant `platform_admin`

`$W/step5.sh` = preamble +:

```bash
USER_ID='<user_id>'
PROJECT_ID='<project_id>'
curl -sS -X POST "$B/management/v1/users/$USER_ID/grants" -H @"$H" --data-binary @- <<EOF
{"projectId":"$PROJECT_ID","roleKeys":["platform_admin"]}
EOF

# Read back
curl -sS -X POST "$B/management/v1/users/grants/_search" -H @"$H" --data-binary @- <<EOF
{"queries":[{"userIdQuery":{"userId":"$USER_ID"}}]}
EOF
```

Expect a grant with `roleKeys: ["platform_admin"]` and state
`USER_GRANT_STATE_ACTIVE`; note its grant `id` for offboarding. **Never grant
Zitadel manager roles** (`IAM_*`, `ORG_*`, project-manager memberships) — they
give IdP-administration power a product operator does not need.

### 6. The `users` mirror row — nothing to do

When the Zitadel webhook does not fire for an operator-created user, the
`users` mirror row is not created at grant time. It is created by the mirror
self-heal on the person's first authenticated admin request
(`apps/api/src/auth/admin-session/admin-session-auth.hook.ts` →
`mirror-self-heal.service.ts`). Authorization rides the `platform_admin` role,
not the mirror row, so login works either way. Do **not** run `reconcile:sweep`
on prod — it is a tsx dev script that is not shipped in the prod api image.

### 7. Deliver the credentials — Mattermost DM from the `bbmka` bot

The password goes **only** in a DM from the `bbmka` bot — never from a human's
account, never by email, never in a channel.

Look up the ids and mint a one-off bot token; the token goes straight into the
scratch dir, never to the screen:

```bash
MMCTL='cd ~/mattermost-deploy && sudo docker compose exec -T mattermost mmctl --local'
ssh tools-prod-tw "$MMCTL user search '<email>'"   # -> recipient <user_id>
ssh tools-prod-tw "$MMCTL bot list --all"          # -> <bot_id> of bbmka
ssh tools-prod-tw "$MMCTL token generate bbmka 'one-off DM to <user> <date>'" > "$W/mm-token.out"
# output is "<token>: <description>"
printf 'Authorization: Bearer %s\nContent-Type: application/json\n' \
  "$(cut -d: -f1 "$W/mm-token.out")" > "$W/mm-auth.h"
```

Write the message text (templates below) into `$W/message-1.txt` (and
`$W/message-2.txt`), substituting the password from `$W/pw.txt` with an editor
or a script — not by copying it through the terminal. Then post:

```bash
MM=https://chat.bbm.academy
CH=$(curl -sS -X POST "$MM/api/v4/channels/direct" -H @"$W/mm-auth.h" \
  --data-binary '["<bot_id>","<user_id>"]' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

for n in 1 2; do   # drop 2 if Message 2 is not sent
  python3 -c 'import json,sys; print(json.dumps({"channel_id":sys.argv[1],"message":open(sys.argv[2],encoding="utf-8").read()}))' \
    "$CH" "$W/message-$n.txt" \
  | curl -sS -X POST "$MM/api/v4/posts" -H @"$W/mm-auth.h" --data-binary @- \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])' > "$W/post-$n.id"
done
```

Revoke the temporary token **immediately** after posting:

```bash
ssh tools-prod-tw "$MMCTL token list bbmka --all"   # id of "one-off DM to <user> <date>"
ssh tools-prod-tw "$MMCTL token revoke <token_id>"
ssh tools-prod-tw "$MMCTL token list bbmka --all"   # confirm it is gone
```

- **Wrong post** (wrong recipient or text):
  `ssh tools-prod-tw "$MMCTL post delete <postId> --confirm --permanent"`.
- **Credential landed in the wrong place:** rotate the password (step 4) and
  resend the corrected message.
- **After the person confirms a successful first login** (and that the password
  is in their password manager), permanently delete Message 1 — it is the only
  post that carries the password — with the same `post delete` command and the
  id in `$W/post-1.id`. Then remove the scratch dir: `rm -rf "$W"`.

### 8. First login — what the person sees

1. `https://admin.doctor.school` → «Электронная почта» + «Пароль» → «Войти».
2. First time only: `/mfa/enroll` — «Подключите приложение-аутентификатор».
   Scan the QR code (or enter the key manually) → «Код из приложения» →
   «Подтвердить и войти».
3. Every later login: password, then `/mfa/challenge` with the app code.

There are no recovery codes. «Код не подошёл» almost always means the phone's
clock is off — enable automatic time. A lost authenticator is reset by the
operator: see
[Admin locked out of the admin panel](./auth-operations.md#admin-locked-out-of-the-admin-panel).

## Message templates

The team uses «ты». Replace every `<placeholder>`; `<password>` is the only
place the password ever appears.

Message 1 — access and first login (always):

```text
<Имя>, привет! Тебе выдан доступ администратора в админку платформы Doctor.School — для работы с <задача>.

**Адрес:** https://admin.doctor.school
**Логин:** <email>
**Пароль:** <password>

**Первый вход**
1. Открой адрес, введи электронную почту и пароль, нажми «Войти».
2. Система попросит подключить приложение-аутентификатор (Яндекс Ключ, Google Authenticator, 1Password): отсканируй QR-код (или введи ключ вручную).
3. Введи шестизначный код из приложения в поле «Код из приложения» и нажми «Подтвердить и войти».

Дальше при каждом входе: пароль + код из приложения.
Если код «не подошёл» — проверь, что время на телефоне выставляется автоматически.
Если потеряешь телефон с приложением — напиши @<Tech Lead handle>, он сбросит.
Пароль лучше сохрани в менеджере паролей.
```

Message 2 — optional, for someone onboarded to work on events:

```text
**Коротко про эфиры в админке**

Раздел «Мероприятия» открывается сразу после входа. Прошедшие эфиры — в том же списке: смотри колонку «Статус» («Завершено» / «Скрыто» / «Архивировано»). Фильтров нет — листай страницы.

«Редактировать» открывает вкладки:
- «Основное» — название, дата, описание, трансляция и кнопки статуса: Черновик → Опубликовано → В эфире → Завершено → Скрыто;
- «Записи» — записи эфира;
- «Эксперты» — спикеры;
- «Проекты» / «Направления».

Поправить прошедший эфир: «Основное» → изменения → «Сохранить».

Запись эфира: «Записи» → «Прикрепить запись» (слот «Монтаж» или «Оригинал трансляции») → выбери провайдера и вставь ID видео (не ссылку) → «Опубликовать». Публикуется, только когда эфир в статусе «Завершено».
Заменить запись — «Изменить источник»; убрать — «Снять с публикации» / «Отозвать».
Записи ещё нет — укажи «Запись ожидается к».

Эфир прошёл не на платформе: «Создать мероприятие» → отметь «Это архивный эфир».
```

## Post-conditions checklist

- [ ] Step 1 search returns exactly one account for `<email>`.
- [ ] Step 4 printed «password verified» (the throwaway session was deleted by the same script).
- [ ] Grant read-back shows `roleKeys: ["platform_admin"]`, `USER_GRANT_STATE_ACTIVE`, and no `IAM_*` / `ORG_*` memberships were added.
- [ ] DM(s) delivered from `bbmka` to the right recipient.
- [ ] Temporary bot token revoked and absent from `token list bbmka --all`.
- [ ] The person confirmed a successful first login (MFA enrolled). The `users` mirror row appears on that first request (step 6).
- [ ] Message 1 permanently deleted after that confirmation; scratch dir `$W` removed.

## Offboarding

**Removing the grant alone does not log the person out.** An admin session does
not re-read Zitadel: at login the roles are copied into a server-side session
record in Redis with a 30-day TTL
(`apps/api/src/auth/admin-session/admin-session.service.ts`,
`ADMIN_SESSION_TTL_SECONDS`), and every admin request is authorized from that
record (`admin-session-auth.hook.ts`, `resolveAdminRequest`). A person whose
grant was removed — or whose Zitadel user was deactivated — keeps full
`platform_admin` in any live session for up to 30 days. The service has a
force-logout primitive (`forceLogout(sub)`), but no operator path calls it
today; that path is tracked in #2420. Until it lands, revocation is the manual
one-off below. **This section changes when #2420 lands.**

Order: remove access in Zitadel first (so no new session can be minted), then
delete the live sessions.

**1. Remove the grant (and optionally deactivate the user)** — on api-prod,
`$W/offboard1.sh` = preamble +:

```bash
USER_ID='<user_id>'
GRANT_ID='<grant_id>'   # from the step 5 read-back
curl -sS -X DELETE "$B/management/v1/users/$USER_ID/grants/$GRANT_ID" -H @"$H"

# If the person should lose ALL Zitadel-backed access, also deactivate the user:
# curl -sS -X POST "$B/v2/users/$USER_ID/deactivate" -H @"$H" --data-binary '{}'
```

**2. Wait at least 5 minutes.** A login that passed the password step before the
grant was removed holds a pending-auth record (5-minute TTL,
`PENDING_TTL_SECONDS`) that already carries the roles; completing MFA inside
that window would still mint a session with `platform_admin`.

**3. Delete the person's admin sessions on data-prod Redis.** Sessions are keyed
`ds:admin-session:<sid>`, and each Zitadel subject has an index set
`ds:admin-session:sub:<sub>` listing its session ids
(`admin-session-store.redis.ts`, the same keys `deleteBySub` uses). The subject
is the Zitadel user id. First find the redis container name:

```bash
ssh ds-data-prod "sudo docker ps --format '{{.Names}}'"   # the data-prod compose redis service
```

Credentials: the data-prod compose runs redis without `requirepass`, bound to
the VPC address only, and the api's `REDIS_URL` (in `/etc/ds-platform/api.env`
on api-prod) names no password and no database index, so `redis-cli` inside the
container reaches the right keyspace (db 0) as is. Confirm before running —
without printing any secret — that `sudo docker inspect <redis_container>
--format '{{json .Config.Cmd}}'` shows no `--requirepass`. If a password is
ever configured, do not pass it with `-a` on a command line; update this
runbook first.

`$W/offboard3.sh` (no preamble):

```bash
set -euo pipefail
R='<redis_container>'
SUB='<user_id>'
IDX="ds:admin-session:sub:$SUB"
rc() { sudo docker exec "$R" redis-cli "$@"; }

echo "indexed sessions: $(rc SCARD "$IDX")"
# Session ids are live credentials — delete them without printing.
rc SMEMBERS "$IDX" | while read -r sid; do
  if [ -n "$sid" ]; then rc DEL "ds:admin-session:$sid" >/dev/null; fi
done
rc DEL "$IDX" >/dev/null
echo "index left: $(rc EXISTS "$IDX")"   # expect 0
```

Run: `run_remote ds-data-prod < "$W/offboard3.sh"`. The person's next admin
request is refused and sends them back to login, where the missing grant stops
them. This manual deletion writes no `auth.session.terminated` audit row (only
`forceLogout` does) — record the offboarding, with date and operator role, in
the tracker item that requested it.

## Security notes

- The bootstrap PAT stays on api-prod: the preamble reads it with `sudo cat`
  into a private header file that the script deletes on exit; it is never in
  argv, never copied to the workstation, a chat or a file elsewhere.
- Where the password travels, and how each copy is cleaned up:

  | Where                                              | Cleanup                                                                                                                                                                        |
  | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `$W/pw.txt`, `$W/message-1.txt` on the workstation | `rm -rf "$W"` at the end of step 7 (the `umask 077` dir is private meanwhile)                                                                                                  |
  | step-4 script fed over ssh                         | streamed from the workstation, written by `run_remote` to a private temp file on api-prod and deleted after the run                                                            |
  | `curl` calls on api-prod                           | the body goes over stdin (heredoc), never in argv                                                                                                                              |
  | Zitadel                                            | stores only the password hash                                                                                                                                                  |
  | Mattermost DM (stored server-side in its DB)       | Message 1 permanently deleted after the person confirms first login; a Mattermost email/push notification of the DM, if the recipient has them enabled, is outside our control |

  Never type or paste the password into a terminal, shell history, email, a
  channel, an Issue, a PR or an agent transcript.

- The `bbmka` token is minted per delivery, described with recipient + date,
  kept in the scratch dir only, and revoked right after posting — verify it is
  gone.
- Never post credentials as a human (your own account or anyone else's).
- Grant only the `platform_admin` project role; never Zitadel manager roles.
- Offboarding is not complete until the live admin sessions are deleted (see
  above).
