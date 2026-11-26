# #4264: Academy home partnership form, main vs head

Approved look: the current main look of the home `#partner-form` section (approved non-canvas source). Head: slot `pr-4264` (`https://academy-pr-4264.stage.doctor.school`, images `eb23d91b37149cf57a0502c11d954923d828426c`). Main: stage main slot (`https://academy-main.stage.doctor.school`, images `4cbb0a6fe354186f588a3a24830fa1da41e592b1`, which includes #4261; main has moved since only by #4279, a FeedCard change that does not touch this section). Captured 2026-11-26 with headless Chromium at 1440 x 900 and 390 x 844, `colorScheme` light/dark (`<html class="… dark">` confirmed), DPR 1. Raw measurements: `measure.json`.

## Captures

| Profile        | main                                        | head                                           |
| -------------- | ------------------------------------------- | ---------------------------------------------- |
| desktop light  | `main-partner-form-desktop-light.png`       | `head-partner-form-desktop-light.png`          |
| desktop dark   | `main-partner-form-desktop-dark.png`        | `head-partner-form-desktop-dark.png`           |
| mobile light   | `main-partner-form-mobile-light.png`        | `head-partner-form-mobile-light.png`           |
| mobile dark    | `main-partner-form-mobile-dark.png`         | `head-partner-form-mobile-dark.png`            |
| error (reject) | `main-partner-form-desktop-light-error.png` | `head-partner-form-desktop-light-error.png`    |
| focus          | n/a                                         | `head-partner-form-desktop-light-focus.png`    |
| accepted       | n/a                                         | `head-partner-form-desktop-light-accepted.png` |
| admin «Заявки» | n/a                                         | `admin-applications-queue.png` (admin-pr-4264) |

## Element comparison

| Element                                                         | Observed                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intro column (eyebrow, heading, lead, direct contacts)          | identical in all four profiles                                                                                                                                                                                                 |
| Fields, labels, placeholders, role select, consent, policy link | identical in all four profiles                                                                                                                                                                                                 |
| Submit «Обсудить партнёрство» (white on brand, 52 px)           | identical: bg `rgb(255,255,255)`, text `rgb(17,77,158)` in all profiles                                                                                                                                                        |
| Reject state (invalid contact, no role, no consent)             | identical: the same three field errors and the «Исправьте ошибки в форме» summary on both; no POST sent on either                                                                                                              |
| **Bot-protection disclosure under the form**                    | **new on head**: «Форма защищена Yandex SmartCaptcha. Условия обработки данных.» from the shared `BotProtectionDisclosure`, `tone="on-primary"`. Main has none. Section grows 633 → 689 px (desktop) and 815 → 890 px (mobile) |
| Page width                                                      | no horizontal scroll at 390 px on either (`scrollWidth` = `clientWidth` = 390)                                                                                                                                                 |

## Disclosure contrast (head)

Text and link `rgb(255,255,255)` on the brand surface `rgb(17,77,158)`: 8.14:1 in light and dark, desktop and mobile (WCAG AA needs 4.5:1, AAA needs 7:1). Text is 13 px (`text-caption`). The link is underlined (`text-decoration-line: underline`) because the colour alone no longer marks it on the brand surface, and it points to `https://yandex.com/legal/smartcaptcha_notice/`.

## Driven on the slot

- Accept by hand: valid values with a synthetic `partnership-4121-<uuid>@example.test` contact. `POST /v1/public/applications/partnership` returned `201` and carried `x-smartcaptcha-token` (the box test token through `@ds/e2e/captcha-stub`). The form shows «Спасибо! Заявка сохранена.», and the row appears in admin «Заявки» on `admin-pr-4264` as «Партнёрство», «Stage fixture», status «Новая».
- Reject by hand: as in the table above, with field errors and the summary, and no request sent.
- Box-observing stage tests: both pass on the slot. They are the `033 EARS-18` accept and unavailable-intake cases in `apps/portal/e2e/academy-home.e2e.spec.ts`. The unavailable case reached the fixture portal through the SSH-tunnel path in `tools/staging/README.md`, because the shared stage edge still answers `404` for the fixture's `POST /v1/public/applications/partnership` until the stage-main converge installs this PR's Caddyfile.
