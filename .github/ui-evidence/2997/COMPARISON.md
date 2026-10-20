# #2997 — SMS sign-in code step, canvas comparison and driven evidence

Source: `design-source/auth.dc.html` (`codeStepHead` / `resentNote`, the `smsCodeStep` branch; vendoring PR Refs #2997).
Runtime: branch `fix/2997-sms-code-step-conditional`, local stand (api :3200 on branch DB `ds_dev_2997`, Academy portal :3201, doctor host :3204, `next dev`), 2026-10-20.

## Driven behavior and interaction evidence

Real Playwright drive on both hosts, `/login` → «По коду» → «SMS» → a number not on file → «Отправить код» → wait out the 60 s cooldown → «Отправить снова». Unknown numbers get the same response as known ones (003 EARS-56), so the step is reached without an account and no SMS is delivered.

| Host        | Profiles                                 | SMS step sentence  | Resend note        | E-mail step (unchanged)       |
| ----------- | ---------------------------------------- | ------------------ | ------------------ | ----------------------------- |
| Academy     | desktop 1440 / mobile 390 × light / dark | pass (8/8 overall) | pass (8/8 overall) | pass, light, desktop + mobile |
| doctor host | desktop 1440 / mobile 390 × light / dark | pass               | pass               | pass, light, desktop + mobile |

Assertions per run (`drive-results.json`, `drive-results-rerun.json`): the sentence reads «Если номер <number> подтверждён в профиле, мы отправили на него код.», the resend notice reads «… мы отправили на него новый код.», the number is the typed value inside `<strong>`, the dark runs have `<html class="dark">`; the e-mail branch reads «Мы отправили код на <address>.». The first drive run hit the real EARS-14 SMS budget (10 sends / h per IP) on six resends — a correct 429; the api was relaunched with the ops overrides `SMS_BUDGET_PER_IP_1H=200` / `SMS_BUDGET_PER_PHONE_1H=20` and those six combinations re-driven.

## Canvas element comparison (element-by-element)

| Canvas element                                                                           | Observed                                     |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Heading «Проверьте телефон» (SMS step)                                                   | match, both hosts, all profiles              |
| Description «Если номер <b>N</b> подтверждён в профиле, мы отправили на него код.»       | match — same words, number bold and as typed |
| Resend note «Если номер <b>N</b> подтверждён в профиле, мы отправили на него новый код.» | match — under the actions row, number bold   |
| E-mail step «Проверьте почту» / «Мы отправили код на <b>A</b>.»                          | match — unchanged                            |
| «← Изменить способ» as the way back to e-mail; no extra link                             | match                                        |
| Code cells, lifetime line, submit, resend countdown, footer links                        | unchanged by this PR (existing code step)    |

The `next dev` indicator («N» badge, bottom-left) is a dev-server overlay, not product UI.
