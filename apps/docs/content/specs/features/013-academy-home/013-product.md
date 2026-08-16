---
title: "Feature 013 — Academy home page & lead capture (PRD)"
description: "Owner-approved product requirements for the public Academy home page at /: the exact curated Academy demo composition and content, working navigation and login, and durable consented partner-lead capture with asynchronous Mattermost notification."
slug: academy-public-013-academy-home-product
epic: ../../product/academy-public/brief.md
parent_issue: https://github.com/doctor-school/ds-platform/issues/1240
reservation_issue: https://github.com/doctor-school/ds-platform/issues/1307
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`013-product-ru.md`](./013-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · delivery reservation: [#1307](https://github.com/doctor-school/ds-platform/issues/1307). Where the earlier epic brief or Stage-A text conflicts with this PRD, the owner-approved Feature 013 contract below takes precedence for the first production release.

## Feature summary

Feature 013 turns `/` from a redirect into the public Doctor.School Academy front door. Its first production release is an **owner-curated landing**, not a dynamic CMS/taxonomy feed: it reproduces the approved Academy demo's exact Russian copy, section composition, two canonical event/project rows, six photographed experts, project cards, partner offer, formats, and footer. The one deliberate production extension is that every visible control is real: navigation and the mobile menu work, login uses the existing authentication flow, and the partner form validates and submits rather than presenting disabled demo fields.

The page addresses a pharma/medical-industry partner in a single full-width hero while still giving doctors direct access to real Academy content. A valid partner request is retained in the platform database together with immutable consent evidence before an asynchronous Mattermost notification is attempted. Mattermost is a working notification, never the only copy of the lead. A direct login continues to land the authenticated user on `/webinars`; taking `/` for the public landing must not turn the marketing page into a post-login detour.

## User stories

The `US-N` ids below remain the stable registry for Feature 013.

- **US-1** — As a **guest doctor**, I can open public `/` and understand what Doctor.School is, who it brings together, and why its education is different without registering first.
- **US-2** — As a **guest doctor**, I can see the two owner-curated Academy broadcasts on the home page and open either canonical destination.
- **US-3** — As a **visitor**, I can use the desktop navigation, mobile menu, section links, footer links, logo, and login action; no visible control is a demo-only dead end.
- **US-4** — As a **guest doctor or partner**, I can inspect the «Кто стоит за брендом» project first and then six real experts with their supplied portraits and credentials, so the Academy's people are concrete rather than generic.
- **US-5** — As a **pharma or medical-industry partner**, I understand the Academy's proposition, the value of partnership, and the five participation formats from the exact owner-approved copy.
- **US-6** — As a **prospective partner**, I can complete a short real form with my required name, optional company, required email-or-Telegram contact, a role selection, and required personal-data consent, and I get actionable validation without losing valid input.
- **US-7** — As a **prospective partner**, after one accepted submission I get an immediate, unambiguous success state and repeated transport attempts do not create duplicate leads.
- **US-8** — As a **commercial-team member**, each accepted lead reaches the dedicated Mattermost destination asynchronously and delivery failures retry without requiring the visitor to resubmit.
- **US-9** — As a **commercial-team member and compliance stakeholder**, the retained database lead is the record of truth and carries immutable evidence of the exact privacy policy accepted at the recorded time.
- **US-10** — As an **authenticated user**, completing login takes me directly to `/webinars`, while opening `/` explicitly still shows the public landing.
- **US-11** — As a **visitor on any supported device or theme**, I can read and operate the complete page at desktop and mobile breakpoints, in light and dark themes, with keyboard and assistive technology.
- **US-12** — As the **Product Lead**, I get the exact approved copy, content rows, portraits, and composition in the first release, with no invented project metrics and no silent substitution by a dynamic feed.

## Approved composition and content contract

The production order is fixed:

1. header;
2. one full-width partner hero;
3. **What**;
4. **People** — the Project block first, then the six photographed experts;
5. **Events**;
6. **Why**;
7. **Projects**;
8. **Partner value**;
9. **Participation formats**;
10. real lead form;
11. footer.

### Header and hero

- The header uses the supplied Doctor.School white logo, the visible labels `Эфиры`, `Проекты`, `Эксперты`, the theme control, and `Войти`.
- `Эфиры` opens `/webinars`; `Проекты` and `Эксперты` move to the corresponding real sections on the page until their separate catalogue features ship. The mobile menu exposes the same destinations and login action. The logo returns to the page top. `Войти` enters the existing login flow.
- Hero eyebrow: `Doctor.School · Врачи учат врачей`.
- Hero audience label: `Партнёрам`.
- H1: `Создаем будущее медицинского образования вместе`.
- Body: `Академия Doctor School объединяет экспертов, индустрию и образовательные инициативы для совместного создания новых специальностей, школ и стандартов медицины.`
- CTA: `Стать партнёром`, taking the visitor to the real lead form.
- Proof line: `14 партнёров · прозрачная модель`.

### What

- Eyebrow / title: `Платформа` / `Что такое Doctor.School`.
- Intro, paragraph 1: `Академия представляет собой масштабную идеологию, в центре которой — врач и пациент. Участие в проектах Академии — это возможность для корпораций реализовать важнейшую социальную миссию.`
- Intro, paragraph 2: `Инвестируя во врачей и открытую базу знаний, партнеры напрямую повышают свой корпоративный ESG-рейтинг и укрепляют безупречную репутацию среди медицинского сообщества.`

| No. | Card          | Exact copy                                                                                                                 |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 01  | `Эксперты`    | `Эфиры и школы ведут практикующие врачи ведущих центров — те, кто оперирует и ведёт приём, а не читает по слайдам.`        |
| 02  | `Образование` | `Живые эфиры, разборы клинических случаев, длинные программы. Бесплатно для врача, без бюрократии и «баллов ради баллов».` |
| 03  | `Индустрия`   | `Платформу финансируют фарм- и медкомпании. Партнёрство прозрачно и не влияет на содержание программ.`                     |
| 04  | `Партнёры`    | `Партнёр получает не баннер, а участие: репутацию в профессиональной среде, соавторство направлений, доступ к экспертам.`  |

### People

- Eyebrow / title: `Люди` / `Объединение лидеров и экспертов`.
- Intro: `Площадка объединяет фаундеров, приглашенных экспертов и лидеров мнений.`
- The first item is the Project block: label `Проект`, title `Кто стоит за брендом`, copy `Серия откровенных разговоров с лидерами рынка о будущем медицинского образования. Участие в проекте дает экспертам возможность публично транслировать свои ценности, давать живую обратную связь и выстраивать прочную нейронную связь с брендом и аудиторией.`
- The Project block contains the same two canonical rows as Events, in the same order, with the exact titles, meta, and hrefs from the Canonical rows table below.
- The Project block is followed by exactly six expert cards:

| Expert                          | Exact credentials copy                                                                                                                                                                                                                                                                                                                        | Exact portrait asset                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `Эдуард Ильдарханов`            | `архитектор смыслов, основатель BBM Academy и Doctor School`                                                                                                                                                                                                                                                                                  | `public/experts/eduard-ildarkhanov.webp`   |
| `Максим Алексеевич Страхов`     | `к. м. н., доцент кафедры травматологии-ортопедии и военно-полевой хирургии РНИМУ им. Н. И. Пирогова, доцент кафедры травматологии и ортопедии АПО ФНКЦ ФМБА России`                                                                                                                                                                          | `public/experts/maksim-strakhov.webp`      |
| `Тимофей Гаев`                  | `кандидат медицинских наук, главный врач профессионального баскетбольного клуба ЦСКА Москва, ведущий специалист Центра спортивной медицины и реабилитации Sport Fizio Life, врач спортивной медицины, травматолог-ортопед, старший преподаватель кафедры травматологии и ортопедии Академии постдипломного образования ФГБУ ФНКЦ ФМБА России` | `public/experts/timofey-gaev.webp`         |
| `Евгений Константинов`          | `независимый эксперт-консультант фармацевтического маркетинга, инженер-конструктор построения рынков и стратегического управления мнениями`                                                                                                                                                                                                   | `public/experts/evgeniy-konstantinov.webp` |
| `Загородний Николай Васильевич` | `Автор более 800 научных и печатных работ, 16 монографий, 34 учебно-методических пособий.` + `Под его руководством защищено 19 докторских и 54 кандидатские диссертации.`                                                                                                                                                                     | `public/experts/nikolay-zagorodniy.webp`   |
| `Бондарев Анатолий`             | `новатор, директор по маркетингу Панбиофарм, независимый эксперт по созданию и управлению фармацевтическими рынками`                                                                                                                                                                                                                          | `public/experts/anatoliy-bondarev.webp`    |

### Events and the canonical rows

Events uses eyebrow / title `Эфиры` / `Ближайшие и последние эфиры`, followed by `Все эфиры`. The first release presents the following two owner-curated rows; it does not infer, fetch, reorder, expire, or replace them from a CMS or taxonomy feed.

| Order/state   | Time/date/school                                                                     | Title and speakers                                                                                                                                                                                        | Exact destination                                                |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1 / scheduled | `11:00` · `МСК` · `16 августа · 180 мин` · `Академия смыслов. Кто стоит за брендом.` | `Синергизм вместо конкуренции в фарме (возможен ли?)` · Эдуард Ильдарханов, Анатолий Бондарев, Тимофей Гаев · Project meta: `16 августа · Эдуард Ильдарханов, Анатолий Бондарев и Тимофей Гаев · 180 мин` | `https://academy.doctor.school/webinars/event-70d250b9`          |
| 2 / past      | `12:00` · `МСК` · `18 июля · 120 мин` · `Кто стоит за брендом.`                      | `B2B — стейкхолдеры реальных решений` · Эдуард Ильдарханов, Евгений Константинов · Project meta: `18 июля · Эдуард Ильдарханов и Евгений Константинов · 120 мин`                                          | `https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd` |

The past row may keep the approved quiet visual treatment, but remains readable, keyboard-operable, and an ordinary working link. The B2B href above is exact, including `?r=wd`.

### Why

- Eyebrow / title: `Зачем` / `Медицинскому образованию нужна другая среда`.
- `Сейчас`: `Формальное НМО: баллы есть, знаний нет`; `Лекции в записи, оторванные от реальной практики`; `Доступ к сильным экспертам зависит от города и связей`; `Реклама, замаскированная под образование`.
- `Мы создаём`: `Живые разборы от практикующих врачей`; `Вопрос эксперту — напрямую, в эфире`; `Одинаковый доступ из любого региона`; `Прозрачное партнёрство: индустрия рядом, но не внутри контента`.

### Projects

- Eyebrow / title: `Проекты` / `Что мы создаём`; link label `Все проекты`.
- Intro: `Не один продукт, а среда: школы по специальностям, сообщества, дискуссии, длинные программы и стандарты качества контента.`

| Card                   | Exact copy                                                       | Secondary label |
| ---------------------- | ---------------------------------------------------------------- | --------------- |
| `Школы`                | `Циклы эфиров по специальностям — от травматологии до педиатрии` | none            |
| `Сообщества`           | `Профессиональные чаты и встречи вокруг школ`                    | none            |
| `Дискуссии и подкасты` | `Разговор о медицине за пределами протоколов`                    | none            |
| `Программы`            | `Длинные образовательные маршруты с куратором`                   | none            |
| `Стандарты`            | `Требования к качеству и независимости контента`                 | `Методология`   |

No invented quantitative project metrics appear. In particular, `38 направлений`, `12 клубов`, `24 выпуска`, and `6 треков` are absent. `Методология` is a descriptive label, not a metric.

### Partner value and participation formats

Partner-value eyebrow / title: `Партнёрам` / `Что получает партнёр`.

| Value                | Exact copy                                                                  |
| -------------------- | --------------------------------------------------------------------------- |
| `Репутация`          | `Бренд рядом с экспертным контентом — в среде, которой врачи доверяют.`     |
| `Участие в среде`    | `Не баннер, а место за столом: события, дискуссии, рабочие группы.`         |
| `Влияние`            | `Соавторство направлений и образовательной повестки — вместе с экспертами.` |
| `Доступ к экспертам` | `Прямой контакт с лидерами мнений — без посредников и агентских наценок.`   |

The section CTA is `Обсудить партнёрство` and moves to the form.

Formats eyebrow / title: `Форматы` / `Как присоединиться`.

| Format                | Exact copy                                             |
| --------------------- | ------------------------------------------------------ |
| `Эксперт`             | `Ведите эфиры и школу по своей специальности`          |
| `Партнёр`             | `Финансируйте направление и стройте репутацию в среде` |
| `Участник подкаста`   | `Расскажите свою историю медицины и индустрии`         |
| `Соавтор направления` | `Запустите новую школу или программу вместе с нами`    |
| `Компания`            | `Корпоративное обучение и совместные проекты`          |

Each format uses the action `Обсудить →` and moves to the same form. These five owner-approved labels also form the role selector's option set; its empty prompt is `Выберите роль`.

### Lead form and footer

- Form eyebrow / title: `Партнёрство` / `Обсудим партнёрство?`.
- Body: `Расскажите о себе — вернёмся с ответом в течение двух рабочих дней. Без рассылок и «прогревов»: один разговор по делу.`
- Direct-contact line: `Или напишите напрямую:` followed by working links `partner@doctor.school` (`mailto:partner@doctor.school`) and `t.me/doctorschool` (`https://t.me/doctorschool`).
- Required `Имя`, placeholder `Как к вам обращаться`.
- Optional `Компания или клиника`, placeholder `Название организации`.
- Required `Email или Telegram`, placeholder `name@company.ru или @username`; a syntactically valid email or Telegram username satisfies the field.
- Optional `Роль` select, empty prompt `Выберите роль`, with the five format labels above.
- Required checkbox copy: `Согласен(а) на обработку персональных данных в соответствии со 152-ФЗ.`
- Link label `Политика конфиденциальности`, exact destination `https://doctor.school/index/privacy-pay`; it opens in a new tab with `noopener noreferrer`, matching the final approved demo.
- Submit label: `Обсудить партнёрство`.
- Accepted result heading: `Заявка отправлена`, accompanied by a clear statement that the team will make contact. The disabled-demo legend/note and all disabled states are absent from production.
- Footer follows the approved demo: light/dark Doctor.School logo variants, links `Эфиры`, `Проекты`, `Эксперты`, `Партнёрство`, line `Врачи учат врачей · 2026`, and the large decorative `Doctor.School` wordmark. The decorative wordmark is hidden from assistive technology.
- Exact brand assets: `public/brand/logo.svg` and `public/brand/logo-white.svg` from the approved source pin.

## Flows

### Discover and navigate (US-1–US-5)

1. A visitor opens public `/` and sees the full-width partner hero followed by the fixed content order above.
2. Desktop navigation or the equivalent mobile menu takes the visitor to `/webinars`, the Projects section, the People section, the partner form, login, or page top as labelled.
3. Either of the two canonical rows opens its exact destination. The same pair remains consistent in the People Project block and Events.
4. Theme selection changes the entire page without hiding content or swapping copy/assets beyond the approved logo variant.

### Submit a partner lead (US-6–US-9)

1. Any partner/form CTA brings the visitor to one real form without discarding entered values.
2. Empty or malformed required input and missing consent keep the request unsent and show an actionable field-level error; other valid input stays intact.
3. On valid submission, the platform accepts one idempotent request, persists the retained lead together with immutable consent evidence, and records a durable asynchronous notification intent before showing success.
4. Success is based on durable database acceptance, not on a synchronous Mattermost response. The visitor sees `Заявка отправлена` without waiting for the channel delivery.
5. A delivery worker uses the dedicated Academy-leads credential, retries transient failures, and never asks the visitor to resubmit. Operational telemetry and errors do not expose the lead's personal data.

### Login (US-3, US-10)

1. `Войти` opens the real existing login flow and the mobile menu exposes the same action.
2. Successful login with no stronger saved destination resolves directly to `/webinars`.
3. An authenticated user who deliberately opens `/` can still read the public landing; the route itself is not an authentication redirect.

## Product acceptance criteria

- `/` returns the public Academy home rather than permanently redirecting to `/webinars`; no page content or lead submission requires prior authentication.
- The exact order, Russian copy, two canonical rows, six names/credentials/portraits, project cards, partner cards, formats, and footer recorded above match the approved source pin. Events and the People Project block use the same two rows and destinations.
- The hero is one full-width partner hero, includes the exact proof line `14 партнёров · прозрачная модель`, and is not the earlier split doctor/partner hero.
- All visible navigation, login, mobile-menu, CTA, direct-contact, event, privacy, and footer controls work. No disabled demo control, hash-only substitute for `/webinars`, or demo-only lead note ships.
- No false quantitative project metrics appear.
- The real form enforces required name, required valid email-or-Telegram contact, and required consent; company and role are optional. Validation is actionable, associated with its field, preserves other input, and prevents an invalid network submission.
- Every accepted request is idempotent: browser retries or a repeated request with the same idempotency identity return the original accepted result rather than creating or notifying a duplicate lead.
- The lead and its consent evidence are durably persisted before asynchronous notification. Consent evidence is immutable and tied to the retained lead: exact policy URL, a stable policy version/content proof, and `acceptedAt` are sufficient to prove what was accepted and when.
- Application-owned lead/evidence rows follow ADR-0009's retained-row lifecycle at the repository's current baseline: erasure or expiry uses the retention-matrix mechanism (value erasure, tombstone, and/or crypto-shred), never physical row deletion as ordinary lifecycle behavior.
- Public lead submission is rate-limited, bot-protected, and idempotent. Rejections and operational logs reveal no personal data and do not confirm whether another person's contact has been stored.
- Mattermost delivery is asynchronous and retryable. A notification outage never loses the database lead, never changes an accepted visitor response into a failure, and never leaks personal data through logs or UI.
- Production delivery is blocked until `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL` is provisioned for the API/notification delivery boundary **and** its destination is verified private, RF-resident/inside the approved personal-data perimeter, and allowlisted under ADR-0011. If that gate is not satisfied, delivery fails closed: no personal data leaves the platform and the retained lead plus notification intent remain durable for later retry. The release-notification `MATTERMOST_WEBHOOK_URL` is never reused for Academy leads.
- The login/menu integration preserves the existing authentication flow and changes the no-destination post-login default to `/webinars`.
- Browser E2E covers the complete reject and accept flows, duplicate submission, real navigation/menu/login destinations, both canonical links, and notification-failure success semantics. Accessibility verification uses axe at both supported breakpoints and in light/dark themes; interactive hover, active, focus, error, loading, and success states are visible and keyboard-operable.
- The page is built only from `@ds/design-system` primitives/tokens and the exact owner-supplied assets; production does not invent substitute portraits, copy, metrics, controls, or page blocks.

## Out of scope

- A dynamic CMS, taxonomy-backed home feed, automatic event selection/reordering, or editorial admin for the home page. The first release is owner-curated from the pinned demo fixtures.
- `/projects`, `/projects/[slug]`, `/experts`, and `/experts/[slug]` catalogue/detail delivery; the real home navigation may use its on-page Projects and People sections until those separate features ship.
- Event-page or webinar-registration mechanics, recording playback, the recordings archive, and changes to the two canonical destination pages.
- Lead CRM lifecycle after capture: assignment, stages, admin UI, scoring, campaigns, confirmation email, or marketing automation.
- Changing the privacy-policy content hosted at `https://doctor.school/index/privacy-pay`; Feature 013 records and links the policy version it receives.
- Analytics instrumentation beyond the operational and security telemetry required to submit and deliver leads safely.

## Open questions

None blocking for product or Stage A. Deployment still has one explicit prerequisite rather than an open decision: before production enablement, provision the dedicated `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL` and verify/allowlist its private RF-resident destination under ADR-0011.

## Approved mockup / content reference

**Stage A and content fidelity are fixed by the clean `apps/academy-demo` tree at commit `7330e4d8a99bdeca73285e2b4eabf09d7021788c`** (source branch/worktree for #1302), specifically:

- `app/academy-home-view.tsx` — composition and all non-fixture copy;
- `app/fixtures.ts` — the two canonical rows, What/Why/Projects/Partner/Formats copy, six expert records, and portrait paths;
- `public/experts/*.webp` — all six owner-supplied portraits;
- `public/brand/logo.svg` and `public/brand/logo-white.svg` — approved footer/header assets.

The source's demo-only behavior is not part of the production approval: disabled login, disabled mobile menu, disabled lead fields, hash navigation used where a production route exists, absence of a submit/success flow, and any intentionally non-interactive demo affordance are replaced by the real behaviors in this PRD. The approved visual treatment and exact copy/assets remain unchanged. Delivery still requires the normal Stage-B owner check on the live stand at desktop/mobile breakpoints and in both themes.
