---
title: "Grant and revoke staff access"
description: "Giving a staff member access to the admin panel and taking it away in «Доступы»: the grant, the second-factor confirmation, the one-time temporary password and its delivery by a Mattermost bot DM, the first login, offboarding with «Отозвать», and the manual bootstrap of an environment's first platform administrator."
lang: en
---

# Grant and revoke staff access

A procedure for the platform administrator who has been asked to give a staff
member access to the admin panel at `https://admin.doctor.school`, or to take it
away. Staff access is managed in the admin section «Доступы» (`/access`,
feature 047): the grant finds or creates the account, adds the role and the event
binding and shows a one-time temporary password; «Отозвать» removes the role and
ends every admin session of the person at once. The only manual path left is
[bootstrapping the first platform administrator](#bootstrap-the-first-platform-administrator)
of an environment, when nobody can sign in to «Доступы» yet.

Roles, not names: this runbook never names a person. Placeholders are written
as `<placeholder>`; never paste a real password, token or PAT into this document,
a PR, an Issue, a chat or an agent transcript.

Related: the [auth operations runbook](./auth-operations.md) — especially
[Admin locked out of the admin panel](./auth-operations.md#admin-locked-out-of-the-admin-panel).

## When to use / prerequisites

- **Owner decision first.** The roles are `platform_admin` («Администратор
  платформы» — the full admin panel, «Доступы» included), `event-registrar`
  (the congress roster of one event, 044 EARS-17/38) and
  `congress-program-committee` (the submissions of the events it is bound to).
  The owner must have decided which role, and for which event, this person gets.
- **Inputs:** the person's corporate email, ФИО (family name first), the role,
  the event for an event-bound role, their Mattermost account on
  `https://chat.bbm.academy`, and a one-phrase description of the work they are
  being given access for (used in the greeting).
- **You need** a `platform_admin` account with an enrolled authenticator, and —
  to deliver a temporary password — ssh access to `tools-prod-tw`, the
  Mattermost box (bbm-owned infra, compose dir `~/mattermost-deploy`).

## Grant access

1. Admin → «Доступы» → «Выдать доступ».
2. Enter the email, the ФИО, the role and, for «Регистратор» or «Программный
   комитет», the event. Submit.
3. The result is one of:
   - **A new account** — the person had no account: it is created with the email
     marked verified, the visitor role `doctor_guest` and the granted role, and a
     temporary password is shown once (below).
   - **An existing account** — the role is added to the person's grant; their
     name, their password and every role they already hold stay. An existing
     account without a password also gets a temporary password.
   - **A refusal at the form**, nothing changed: the person already holds this
     access; a registrar is already bound to another event; the email of the
     existing account is not verified (ask the person to confirm their email and
     grant again); more than one account holds the email.
4. «Сервис временно недоступен» with «Повторить» means the identity provider did
   not answer. Repeat the same grant: it finishes what the first attempt started
   and records the grant once.

A staff member is a user of the sites too: `doctor_guest` is the visitor role
(their own events, rooms, profile), the staff role the admin rights on top. Every
participant count, roster and presence figure leaves staff accounts out — no
manual step.

## Confirm with a current code

A grant and a revocation need a second factor no older than 30 minutes. When it
is older, the admin opens the code screen instead of sending the request: enter
the current code from your authenticator app, and the admin returns to «Доступы»
and sends the same request again — the form keeps what you entered. Further
grants and revocations within 30 minutes ask for no code. The code refreshes only
the second-factor time of your current session; it does not sign you in again.

## The temporary password

The temporary password is shown **once**, in the grant result, with a copy
action. It exists nowhere else: it is not stored, logged, audited or emailed, and
it cannot be shown again. It is a working password with no forced change — the
person keeps it (in a password manager) and enrols their authenticator at the
first sign-in. If it is lost before delivery, the person sets a new one with the
password reset of the sites' sign-in screen.

## Deliver the credentials — Mattermost DM from the `bbmka` bot

The password goes **only** in a DM from the `bbmka` bot — never from a human's
account, never by email, never in a channel. A grant to an account that already
had a password shows none; send only the access message then, without the
password line.

Keep every scratch file in one private directory and never print a secret to
the terminal:

```bash
umask 077
W=$(mktemp -d)        # scratch dir for this delivery; removed at the end
```

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
`$W/message-2.txt`), pasting the password copied from «Доступы» with an editor —
not through the terminal. Then post:

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
- **Credential landed in the wrong place:** have the person set a new password
  with the password reset of the sites' sign-in at once, and resend the corrected access message.
- **After the person confirms a successful first login** (and that the password
  is in their password manager), permanently delete Message 1 — it is the only
  post that carries the password — with the same `post delete` command and the
  id in `$W/post-1.id`. Then remove the scratch dir: `rm -rf "$W"`.

## First login — what the person sees

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
<Имя>, привет! Тебе выдан доступ в админку платформы Doctor.School — для работы с <задача>.

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

Message 2 — optional, for someone given access to work on events:

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

- [ ] The person's row is in «Доступы» with the right role and event.
- [ ] DM(s) delivered from `bbmka` to the right recipient.
- [ ] Temporary bot token revoked and absent from `token list bbmka --all`.
- [ ] The person confirmed a successful first login (authenticator enrolled).
- [ ] Message 1 permanently deleted after that confirmation; scratch dir `$W` removed.

## Offboarding

Admin → «Доступы» → the person's row → «Отозвать», and confirm. One revocation
takes away one row: for an event-bound role, the binding to that event; the role
leaves the person's grant once no other binding of it remains. `doctor_guest` and
every other role stay, so the person keeps their visitor account on the sites.
To take away all staff access, revoke each of the person's rows.

**Every revocation ends all admin sessions of the person at once** — and every
admin sign-in that passed the password step but has not finished the second
factor — even when they keep other staff roles: their next admin request sends
them back to the login, where they sign in again with what remains. There is no
waiting period and no manual session clean-up.

- **«Сервис временно недоступен» with «Повторить».** The identity provider did
  not apply the change. The person's admin sessions are already ended, and an
  event binding is already removed; repeat the same «Отозвать» to finish the
  revocation. Until then the row stays in the list (for an event-bound role, with
  an empty event).
- **Your own «Администратор платформы» cannot be revoked** — so the last platform
  administrator can never lock everyone out. Another platform administrator
  revokes it.
- **A person leaving the organization altogether:** besides revoking their
  rows, the identity-provider account itself can be deactivated by the operator
  ([auth operations runbook](./auth-operations.md)); «Доступы» does not
  deactivate accounts.

Every grant and revocation is recorded in the audit ledger (`auth.role.granted`
/ `auth.role.revoked`, with the person, the role, the event and the acting
administrator); no separate tracker record of the offboarding is needed.

## Bootstrap the first platform administrator

Only for an environment with no platform administrator yet (or when the admin
itself is unavailable): the grant «Доступы» cannot make, because nobody can sign
in to it. Every later grant goes through «Доступы».

**Access you need** (workstation ssh alias): `ds-api-prod` —
`deploy@77.233.220.222`, key `~/.ssh/ds-api-prod`; sudo is needed to read the
bootstrap PAT and `api.env`. Public self-registration on `id.doctor.school` is
DISABLED (login-policy posture in `infra/deploy/README.md`), so the account is
created by the operator. The `platform_admin` grant snippet in
`infra/deploy/README.md` (IdP section, «Operator access to the product admin
app») is the same call as step 5.

### Workstation setup

Keep every scratch file in one private directory and never print a secret to
the terminal:

```bash
umask 077
W=$(mktemp -d)        # scratch dir for this bootstrap; removed at the end
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
step — a forced change would leave the person stuck. Deliver the password as in
[Deliver the credentials](#deliver-the-credentials--mattermost-dm-from-the-bbmka-bot),
substituting it from `$W/pw.txt` with an editor or a script.

### 5. Grant `doctor_guest` + `platform_admin`

`$W/step5.sh` = preamble +:

```bash
USER_ID='<user_id>'
PROJECT_ID='<project_id>'
curl -sS -X POST "$B/management/v1/users/$USER_ID/grants" -H @"$H" --data-binary @- <<EOF
{"projectId":"$PROJECT_ID","roleKeys":["doctor_guest","platform_admin"]}
EOF

# Read back
curl -sS -X POST "$B/management/v1/users/grants/_search" -H @"$H" --data-binary @- <<EOF
{"queries":[{"userIdQuery":{"userId":"$USER_ID"}}]}
EOF
```

Expect a grant with `roleKeys: ["doctor_guest","platform_admin"]` and state
`USER_GRANT_STATE_ACTIVE`. **Never grant Zitadel manager roles** (`IAM_*`,
`ORG_*`, project-manager memberships) — they give IdP-administration power a
product operator does not need.

An existing grant (one per user and project — a second POST answers «already
exists») is widened in place:

```bash
GRANT_ID='<grant id from the read-back>'
curl -sS -X PUT "$B/management/v1/users/$USER_ID/grants/$GRANT_ID" -H @"$H" --data-binary @- <<EOF
{"roleKeys":["doctor_guest","platform_admin"]}
EOF
```

### 6. The `users` mirror row — nothing to do

When the Zitadel webhook does not fire for an operator-created user, the
`users` mirror row is not created at grant time. It is created by the mirror
self-heal on the person's first authenticated admin request
(`apps/api/src/auth/admin-session/admin-session-auth.hook.ts` →
`mirror-self-heal.service.ts`). Authorization rides the `platform_admin` role,
not the mirror row, so login works either way. Do **not** run `reconcile:sweep`
on prod — it is a tsx dev script that is not shipped in the prod api image.

Bootstrap post-conditions: step 1 returns exactly one account for `<email>`;
step 4 printed «password verified»; the grant read-back shows
`roleKeys: ["doctor_guest","platform_admin"]`, `USER_GRANT_STATE_ACTIVE` and no
`IAM_*` / `ORG_*` memberships; the person signs in and their row appears in
«Доступы». Every later grant is made there.

## Security notes

- The temporary password of a «Доступы» grant is shown once and exists nowhere
  else; copy it straight into the DM draft.
- The bootstrap PAT stays on api-prod: the bootstrap preamble reads it with
  `sudo cat` into a private header file that the script deletes on exit; it is
  never in argv, never copied to the workstation, a chat or a file elsewhere.
- Where the password travels, and how each copy is cleaned up:

  | Where                                              | Cleanup                                                                                                                                                                        |
  | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | the «Доступы» grant result                         | shown once; gone when the result is closed                                                                                                                                     |
  | `$W/pw.txt`, `$W/message-1.txt` on the workstation | `rm -rf "$W"` after the delivery (the `umask 077` dir is private meanwhile)                                                                                                    |
  | bootstrap step-4 script fed over ssh               | streamed from the workstation, written by `run_remote` to a private temp file on api-prod and deleted after the run                                                            |
  | Zitadel                                            | stores only the password hash                                                                                                                                                  |
  | Mattermost DM (stored server-side in its DB)       | Message 1 permanently deleted after the person confirms first login; a Mattermost email/push notification of the DM, if the recipient has them enabled, is outside our control |

  Never type or paste the password into a terminal, shell history, email, a
  channel, an Issue, a PR or an agent transcript.

- The `bbmka` token is minted per delivery, described with recipient + date,
  kept in the scratch dir only, and revoked right after posting — verify it is
  gone.
- Never post credentials as a human (your own account or anyone else's).
- Grant only the product roles; never Zitadel manager roles.
- Offboarding is «Отозвать» in «Доступы»: it ends the person's admin sessions at
  once.
