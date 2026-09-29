---
title: "Onboard a staff member as Academy admin"
description: "End-to-end procedure for giving a staff member access to the Academy admin panel: find or create their Zitadel account, set a password, grant platform_admin, deliver the credentials by a Mattermost bot DM, and what their first login looks like."
lang: en
---

# Onboard a staff member as Academy admin

A standalone procedure for the operator (the **Tech Lead / System Architect** in
Phase 0) who has been asked to give a staff member access to the Academy admin
panel at `https://admin.doctor.school`. It covers the whole path: account in
Zitadel (`https://id.doctor.school`), password, project-role grant, credential
delivery and the person's first login.

Roles, not names: this runbook never names a person. Placeholders are written
as `<placeholder>`; never paste a real password, token or PAT into this document,
a PR, an Issue or a chat.

Related: the `platform_admin` grant snippet in
`infra/deploy/README.md` (IdP section, «Operator access to the product admin
app») and the
[auth operations runbook](./auth-operations.md) — especially
[Admin locked out of the admin panel](./auth-operations.md#admin-locked-out-of-the-admin-panel).

## When to use / prerequisites

- **Owner decision first.** Onboarding grants the full `platform_admin` project
  role — the admin panel authorizes on that role in the token. There is **no
  narrower events-only role**: `event-registrar` (044 EARS-17) authorizes the
  congress roster surface only, per event, and is not a substitute. The owner
  must have decided that this person gets full admin access.
- **Inputs:** the person's corporate email, first and last name (Zitadel
  requires both), their Mattermost account on `https://chat.bbm.academy`, and a
  one-phrase description of the work they are being onboarded for (used in the
  greeting).
- **Access you need:**
  - api-prod: `ssh -i ~/.ssh/ds-api-prod deploy@77.233.220.222` (sudo needed to
    read the bootstrap PAT and `api.env`).
  - Mattermost box: ssh alias `tools-prod-tw` (bbm-owned infra, compose dir
    `~/mattermost-deploy`).
- **Why the operator creates the account:** public self-registration on
  `id.doctor.school` is DISABLED (login-policy posture in
  `infra/deploy/README.md`), so staff accounts are created by the operator.

**Running remote scripts over ssh.** Plain `ssh host bash -s < file` loses
stdin to inner commands (`sudo`, `curl`). Feed a script file like this instead:

```bash
ssh <host> 'script=$(cat); exec bash -c "$script"' < ./step.sh
```

Steps 1–5 run on api-prod; the bootstrap PAT never leaves that box.

## Steps

### 1. Look up the person

On api-prod:

```bash
T=$(sudo cat /etc/ds-platform/idp-bootstrap-pat.txt)
B=https://id.doctor.school
EMAIL='<email>'

curl -sS -X POST "$B/management/v1/users/_search" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"queries\":[{\"emailQuery\":{\"emailAddress\":\"$EMAIL\",\"method\":\"TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE\"}}]}"
```

`result[].id` is the user id. An empty (or absent) `result` means there is no
account — go to step 3. If the account exists, skip step 3, keep its id as
`USER_ID`, and decide with the person whether to set a new password (step 4) or
let them keep their current one.

### 2. Resolve the project and organization ids

Do not hardcode either id; read them on api-prod each time.

```bash
# OIDC project id — grep the single key; do NOT `source` api.env
# (a value in it currently breaks shell sourcing).
IDP_PROJECT_ID=$(sudo grep '^IDP_PROJECT_ID=' /etc/ds-platform/api.env | cut -d= -f2)

# Organization = the bootstrap PAT's own org
# (same rule as tools/staging/idp.mjs resolveOrgId).
ORG_ID=$(curl -sS "$B/auth/v1/users/me" -H "Authorization: Bearer $T" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["user"]["details"]["resourceOwner"])')
echo "project=$IDP_PROJECT_ID org=$ORG_ID"
```

### 3. Create the human user

Only when step 1 found no account.

```bash
curl -sS -X POST "$B/v2/users/new" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"organizationId\":\"$ORG_ID\",\"username\":\"$EMAIL\",\"human\":{\"profile\":{\"givenName\":\"<first>\",\"familyName\":\"<last>\"},\"email\":{\"email\":\"$EMAIL\",\"isVerified\":true}}}"
```

Keep the response field `id` (not `userId`) as `USER_ID`. `givenName` and
`familyName` are required by Zitadel. `isVerified: true` because the operator
vouches for the corporate address — no verification mail is sent.

### 4. Set and verify the password

Generate the password on your workstation: 16 characters, upper + lower +
digit + exactly one symbol from `-_!@#%`, no ambiguous characters
(`0 O o 1 l I`), never starting or ending with the symbol. For example:

```bash
python3 - <<'EOF' > ./pw.txt
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

Keep it only in that scratch file; delete the file after delivery (step 7).
Set it on api-prod (pass it through your ssh script, never through shell
history on a shared box):

```bash
PW='<password>'
curl -sS -X POST "$B/v2/users/$USER_ID/password" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"newPassword\":{\"password\":\"$PW\",\"changeRequired\":false}}"
```

`changeRequired: false` because the admin login surface has no forced-change
step — a forced change would leave the person stuck.

Verify the password with a throwaway session, then delete it:

```bash
SID=$(curl -sS -X POST "$B/v2/sessions" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"checks\":{\"user\":{\"loginName\":\"$EMAIL\"},\"password\":{\"password\":\"$PW\"}}}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sessionId",""))')
echo "session: ${SID:+OK}"   # a present sessionId = password accepted

curl -sS -X DELETE "$B/v2/sessions/$SID" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}'
```

### 5. Grant `platform_admin`

```bash
curl -sS -X POST "$B/management/v1/users/$USER_ID/grants" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$IDP_PROJECT_ID\",\"roleKeys\":[\"platform_admin\"]}"
```

Read it back:

```bash
curl -sS -X POST "$B/management/v1/users/grants/_search" \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d "{\"queries\":[{\"userIdQuery\":{\"userId\":\"$USER_ID\"}}]}"
```

Expect a grant with `roleKeys: ["platform_admin"]` and state
`USER_GRANT_STATE_ACTIVE`. Keep its grant `id` for offboarding. **Never grant
Zitadel manager roles** (`IAM_*`, `ORG_*`, project-manager memberships) — they
give IdP-administration power a product operator does not need.

### 6. The `users` mirror row — nothing to do

When the Zitadel webhook does not fire for an operator-created user, the
`users` mirror row is not created at grant time. It is created by the
mirror self-heal on the person's first authenticated admin request
(`apps/api/src/auth/admin-session/admin-session-auth.hook.ts` →
`mirror-self-heal.service.ts`). Authorization rides the `platform_admin` role in
the token, not the mirror row, so login works either way. Do **not** run
`reconcile:sweep` on prod — it is a tsx dev script that is not shipped in the
prod api image.

### 7. Deliver the credentials — Mattermost DM from the `bbmka` bot

The password goes **only** in a DM from the `bbmka` bot — never from a human's
account, never by email, never in a channel.

On `tools-prod-tw`, in `~/mattermost-deploy`:

```bash
cd ~/mattermost-deploy
M="sudo docker compose exec -T mattermost mmctl --local"

$M user search '<email>'        # -> recipient user id
$M bot list --all               # -> user id of the bbmka bot
$M token generate bbmka "one-off DM to <user> <date>"   # prints "<token>: <description>"
```

From your workstation, with the temporary token:

```bash
MM=https://chat.bbm.academy
TOKEN='<token>'

CH=$(curl -sS -X POST "$MM/api/v4/channels/direct" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '["<bot_id>","<user_id>"]' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

# Post Message 1 (and optionally Message 2) — see templates below.
# Build the JSON with a tool that escapes newlines, e.g.:
python3 -c 'import json,sys; print(json.dumps({"channel_id":sys.argv[1],"message":open(sys.argv[2],encoding="utf-8").read()}))' \
  "$CH" ./message-1.txt > ./post-1.json
curl -sS -X POST "$MM/api/v4/posts" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @./post-1.json
```

Revoke the temporary token **immediately** after posting, on `tools-prod-tw`:

```bash
$M token list bbmka --all       # find the id whose description is "one-off DM to <user> <date>"
$M token revoke <token_id>
$M token list bbmka --all       # confirm it is gone
```

Then delete the local scratch files (`pw.txt`, `message-1.txt`, `post-*.json`).

- **Wrong post** (wrong recipient or text): `$M post delete <postId> --confirm --permanent`.
- **Credential landed in the wrong place:** rotate the password (step 4) and
  resend the corrected message.

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
- [ ] Password verified with a throwaway session (step 4), and that session deleted.
- [ ] Grant read-back shows `roleKeys: ["platform_admin"]`, `USER_GRANT_STATE_ACTIVE`, and no `IAM_*` / `ORG_*` memberships were added.
- [ ] DM(s) delivered from `bbmka` to the right recipient.
- [ ] Temporary bot token revoked and absent from `token list bbmka --all`.
- [ ] Local scratch files (password, message, post bodies) deleted.
- [ ] The person confirmed a successful first login (MFA enrolled). The `users` mirror row appears on that first request (step 6).

## Offboarding

The inverse: remove the project role, or deactivate the user entirely. On
api-prod, find the grant id with the step 5 read-back, then
`DELETE $B/management/v1/users/<USER_ID>/grants/<grantId>` (with the same
bootstrap PAT). If the person should lose all access to Zitadel-backed
surfaces, deactivate the user instead of (or in addition to) removing the
grant. Their next admin request is refused once the new token no longer
carries `platform_admin`.

## Security notes

- The bootstrap PAT stays on api-prod: read it with `sudo cat` inside the
  remote script; never copy it to the workstation, a chat or a file.
- The password exists in exactly two places: the local scratch file (deleted
  after delivery) and the bot DM. Never in email, a channel, an Issue, a PR or
  shell history on a shared box.
- The `bbmka` token is minted per delivery, described with recipient + date,
  and revoked right after posting — verify it is gone.
- Never post credentials as a human (your own account or anyone else's).
- Grant only the `platform_admin` project role; never Zitadel manager roles.
