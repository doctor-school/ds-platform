## Summary

Congress intake settings screen in the admin (trimmed copy of the PR #2451 body shape, Issue #2489).

## Delivery evidence

- `pnpm pr:preflight --static`: 33 PASS, 1 WARN (`showcase-coverage`, pre-existing on main).

## Product note (RU)

В админке у мероприятия появилась ссылка «Приём материалов Конгресса». На этой странице администратор платформы настраивает, как Конгресс принимает материалы:

- адрес регистрации участников — ссылка для тех, кто ещё не зарегистрирован на Конгресс;
- для каждого вида — «Устный доклад», «Постерный доклад», «Тезисы» — дата открытия приёма и лимит заявок.
  Все даты — календарные дни по московскому времени, последний день включительно.

registry-research: adopted — shadcn/ui-based `@ds/design-system` (Card, Form, Input, Switch, Button, Alert, Link)
ui-source-kind: approved-non-canvas
ui-render-desktop-light: https://raw.githubusercontent.com/doctor-school/ds-platform/33592265c6dd43d97e0d787bab210f0fff81ff32/.github/ui-evidence/2432/intake-defaults-desktop-light.png
Stage-B: GO — owner verdict 2026-09-29 on slot pr-2451
Stage-B-head: 33592265c6dd43d97e0d787bab210f0fff81ff32
Stage-B-owner-quote: По стенду Го, если сама форма прошла тестирование.

Applicability: the owner walked head 5ad87ea5; head 33592265 only removes one field.
Changeset: `.changeset/congress-intake-settings-2432.md`
Behavior change: new admin routes `GET`/`PUT /v1/admin/events/:id/congress-intake-settings`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_00000000000000000000000000
