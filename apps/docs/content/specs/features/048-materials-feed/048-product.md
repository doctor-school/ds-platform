---
title: "Feature 048 — Materials feed: platform news and external sources (PRD)"
description: "Product requirements for the Academy materials feed: one horizontal rail on the Academy home (029) that mixes news and expert columns authored on the platform with posts and videos from the official BBM Academy accounts on external platforms, newest first. Delivered in slices — own materials first, then one source connector per network (Telegram, VK / VK Видео, RuTube, Dzen). Source of the 048 EARS triplet (ADR-0014)."
slug: two-site-ia-048-materials-feed-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`048-product-ru.md`](./048-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · Functional-map registry row 048 (`apps/docs/content/specs/product/two-site-ia/functional-map-ru.md` §B). Owner decisions of 2026-10-28 are recorded on [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions»; owner decisions of 2026-10-29 are quoted verbatim below with the source «owner, chat 2026-10-29» and recorded on [#3403](https://github.com/doctor-school/ds-platform/issues/3403). Lead decisions are marked _(lead decision; owner sees it at Stage A)_; anything else this PRD adds beyond those decisions is marked `agent-proposed — UNCONFIRMED`.

## Feature summary

The Academy home (029) carries **one feed of materials** — «Всё вперемешку на одной стене, и видео тоже» (owner, chat 2026-10-29). It replaces both the «Новости и блог» and the «Рилсы и видео» blocks of the home canvas: the Academy's own news, expert columns, posts from the official BBM Academy accounts on other networks and videos from their video accounts sit together, mixed, newest first.

The feed is **one horizontal rail** — «Давай лучше сделаем бесконечную горизонтальную ленту» (owner, chat 2026-10-29): the next card is partly visible, desktop has always-visible ←/→ buttons, a phone swipes, the keyboard scrolls it, older materials load as the visitor nears the end, nothing rotates by itself and no video plays by itself. _(UI basis — lead decision from research; owner sees it at Stage A: horizontal scrolling works only with a clear cue that more content lies sideways and an explicit control — [NN/g, horizontal scrolling, 2014](https://www.nngroup.com/articles/horizontal-scrolling/); auto-rotation is ignored or disrupts reading — [NN/g, auto-forwarding](https://www.nngroup.com/articles/auto-forwarding/); a growing list of articles is announced to assistive technology as a feed and stays keyboard-reachable — [W3C APG feed pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/examples/feed/), [Deque, infinite scrolling and role=feed](https://www.deque.com/blog/infinite-scrolling-rolefeed-accessibility-issues/).)_

Only **official** accounts appear, and the admin keeps their list. The networks are connected **one at a time** — «важно всё сделать модульно. Сначала мы добавим только наши внутренние новости. И потом будем постепенно подключать каждую соцсеть, чтобы не застревать сейчас на агрегации всего и интеграциях» (owner, chat 2026-10-29). The accounts are the **BBM Academy** accounts, not Doctor.School ones: «Показываем из Bbm, не доктор скул. Именно на сайте академии» (marketing, relayed by the owner, [#3403 comment 6490823839](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490823839)). The starting set is **Telegram, VK / VK Видео, RuTube and Dzen**, all of them BBM Academy accounts (owner, [#3403 comment 6490905025](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490905025); addresses in «Source connectors» below). Out of the start: Instagram — open with the owner, the network is blocked in the RF; Threads, TikTok, Pinterest; and YouTube — «YouTube в РФ заблокирован - я не понял, что он делает на главной» (owner, chat 2026-10-29), marketing: «нет, пока» ([#3403 comment 6490823839](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490823839)). No further networks are added now; Max may come later (marketing, [#3403 comment 6490823839](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490823839)).

Under the owner's governing principle for this cascade — «не городить временные костыли … сразу делать нормально» — every material on the home comes from this real, admin-managed feed: no hand-set tiles, no placeholder that is replaced later.

The feed is a shared capability: the 029 home only reads it. Its capability owner is a new row in [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md), registered when the design spec is written (ADR-0013 §A1). Storefront affiliation (ADR-0016 §8): materials — `академия`; sources — `только админка`.

## Source connectors and the common card

Each network is a separate **source connector** that translates that network's publications into **one common card shape**: kind (news, expert column, network post, video), title or the post's first lines, date of publication, preview image, duration (videos), source (platform and account), permalink, and a partner mark. The rail and the admin know only that shape. A new network is a new connector plus a row in the admin source list — no rework of the rail, the admin screens or the materials already in the feed (US-10).

The official accounts of the starting set — BBM Academy's own accounts, from the marketing accounts sheet (tab «Соц.сети»; owner, [#3403 comment 6490905025](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490905025)):

| Network       | Account                       | What the connector reads         |
| ------------- | ----------------------------- | -------------------------------- |
| Telegram      | `t.me/bbmacademy`             | channel posts                    |
| VK / VK Видео | `vk.ru/bbm.academy`           | wall posts and VK Видео videos   |
| RuTube        | channel 32061512 «bbmacademy» | videos                           |
| Dzen          | `dzen.ru/bbmacademy`          | posts (slice 5 decides the path) |

The admin source list (US-3) is where these addresses live; the table records the starting accounts, not a hard-coded list.

Only card data is stored. Video files are never stored, and media hosted on a network is not mirrored into our storage; whether a network's preview image is copied or referenced follows that network's terms and is settled in the design spec ([research](./048-platform-access-research.md): Telegram preview links expire, so a Telegram preview is copied; VK Rules §1.6 forbid autonomous media stores). The retention period of stored card data is set in the design spec, together with the storage itself.

## Delivery slices

The feature ships in five slices; each later slice adds one connector and changes nothing in the earlier ones.

1. **Own materials.** The admin authors news and expert columns (US-1, US-2), the reading page (US-8), and the rail on the Academy home with all its states (US-6, US-9). The source list and US-5 exist from the first network slice on.
2. **Telegram.** A bot in our channel receives each new `channel_post` (and its edits); the posts published before the bot joined are brought in once by a one-off import, because the Bot API cannot read channel history.
3. **VK posts and VK Видео.** The VK Callback API pushes new wall posts and videos (`wall_post_new`, `video_new`); the VK business profile is verified, because an unverified profile is capped at 10 000 API calls a month. The route for VK clips is undocumented and stays `UNCONFIRMED` until the slice is designed.
4. **RuTube.** `blocked_by` RuTube's written confirmation that the public channel-list endpoint may be used: it works today, but its only official description dates from 2016 and RuTube's terms grant no API use. Marketing sends the letter (text: [#3403 comment 6490007758](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490007758)).
5. **Dzen.** «Дзен точно делаем - мы туда пишем посты» (owner, chat 2026-10-29). Dzen has no read interface, and its terms (§5.1) forbid automated access without the company's permission, so reading Dzen pages is out. Marketing sends Dzen a permission letter (owner of the step: «Маркетинг»; text: [#3403 comment 6490007758](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490007758)). If Dzen refuses, the direction reverses: the material is written on the Academy and Dzen imports it through its «Сайт в канал» RSS, so the feed shows the Academy's own record.

Per-platform mechanism, fields, limits and terms: [`048-platform-access-research.md`](./048-platform-access-research.md).

## User stories

- **US-1** — As a **platform administrator**, I write a news item or an expert column in the admin (written in `apps/admin`, see Flows — Platform material, step 1) — columns in this feature are written by the team on the expert's behalf _(lead decision 2026-10-28; owner sees it at Stage A)_ — preview it and publish it, so the Academy can say something on its own site without posting it elsewhere first.
- **US-2** — As a **platform administrator**, I edit or unpublish a platform material I published, and the change shows on the site without a release.
- **US-3** — As a **platform administrator**, I keep the list of official accounts the feed reads: for each account I set its platform and its address, and I can switch an account off without deleting what it already brought in.
- **US-4** — As a **platform administrator**, materials published on the connected accounts appear in the feed by themselves; nobody copies posts into the admin by hand.
- **US-5** — As a **platform administrator**, I can hide one specific external material from the feed (an off-topic or outdated post) without switching off the whole account. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-6** — As an **Academy visitor**, the home shows one horizontal rail with the latest materials of every kind mixed together — news, expert columns, network posts and videos — newest first. Each card tells me its kind, its title (or the post's first lines), its source and date; a video card also shows its preview and duration. I see that the rail goes on (the next card is partly visible), move it with the ←/→ buttons on a computer, by swiping on a phone or with the keyboard, and older materials load as I near the end. Nothing in the rail moves or plays by itself.
- **US-7** — As an **Academy visitor**, a card from another network — a post or a video — opens its original on its platform in a new tab; nothing plays inside the Academy. _(lead decision 2026-10-29; owner sees it at Stage A)_
- **US-8** — As an **Academy visitor**, I open a platform-authored news item or column and read it on its own reading page on the Academy itself — a platform material otherwise has nowhere to link. Owner: «давай-ка мы сразу сделаем правильно, так как задумано» (owner, chat 2026-10-29).
- **US-9** — As an **Academy visitor**, while the feed is loading, when there is nothing in it yet, or when it could not be loaded, the rail tells me so honestly and lets me retry — never a fake entry, never a blank hole.
- **US-10** — As a **product owner**, when marketing names a new platform, it joins the feed as a new source connector next to the existing ones, without redesigning the rail or migrating materials already in the feed.

## Flows

**Platform material (US-1, US-2, US-6, US-8) — slice 1:**

1. The administrator opens the materials section of the admin (047 access: role `platform_admin`, admin session with TOTP per 011) and creates a material: kind (news / expert column), title, text, cover image (optional), author line. For an expert column the author is chosen from the experts directory (012). _(Field set — agent-proposed — UNCONFIRMED.)_ Materials are written in the admin app `apps/admin` and stored as platform domain data through the platform API — not in the Payload CMS `apps/cms`: ADR-0004 §10.1 limits Payload to marketing content (`pages`, `blocks`, `glossary`, `media`) and forbids it to own domain data, and `apps/cms` is a reserved empty scaffold. The text is written in a rich-text editor primitive of `@ds/design-system` built on TipTap (ADR-0004 design: «Rich-text editor … → TipTap + custom extensions»); it is the one admin element outside the approved admin kit, so its look goes to the owner at Stage A as that element alone. The stored body format and its sanitised render on the reading page are settled in the design spec. _(lead decision 2026-10-29; owner sees it at Stage A)_
2. The administrator previews and publishes it; it becomes the first card of the rail on the Academy home.
3. A visitor taps the card → reads the material on its Academy page.
4. The administrator edits or unpublishes it → the site reflects the change; an unpublished material leaves the rail and its page stops being public.

**External source (US-3, US-4, US-5, US-7) — slices 2–5, one network each:**

1. The administrator adds an official account: platform (one of the connected networks) and its address.
2. New publications of that account appear in the rail automatically as cards of their kind (network post or video). Cards keep the platform's own publication date.
3. A visitor taps an external card → the original opens on its platform in a new tab.
4. The administrator hides an unwanted post → it leaves the rail; switching an account off stops new materials from it and removes its materials from the rail, without deleting them from the admin. _(agent-proposed — UNCONFIRMED.)_

**Branches:**

- **A platform is temporarily unreachable** → the rail keeps showing what it already has from that account and the rest of the feed; the visitor sees no error for a single source. _(agent-proposed — UNCONFIRMED.)_
- **The whole feed cannot be read** → the rail shows an error state with «Повторить». _(Copy carried from the home canvas «Новости и блог» error state «Не удалось загрузить новости.» until the rail canvas is drawn — agent-proposed — UNCONFIRMED.)_
- **The feed is empty** → the rail shows an empty state. _(Copy carried from the home canvas «Записей пока нет. Здесь появятся колонки экспертов и новости проектов.» until the rail canvas is drawn — agent-proposed — UNCONFIRMED.)_
- **A source account is removed by its platform or renamed** → the administrator sees the account as failing in the source list. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- Per-platform access — keys and the terms of use for reading our own publications — is researched before the network's slice is designed ([research](./048-platform-access-research.md)); a network that cannot be read lawfully is not read: it waits for written permission or uses a documented lawful path (Dzen: import into Dzen from the Academy's RSS).
- One feed holds platform-authored materials and materials from external official accounts; the 029 home reads it and holds no materials of its own.
- The home shows one horizontal rail in place of both «Новости и блог» and «Рилсы и видео»: every kind mixed, newest first; the next card partly visible; ←/→ buttons always visible on desktop; swipe on a phone; keyboard scrolling; older materials load near the end; no auto-rotation; no video autoplay.
- Every card has the common card shape (kind, title or first lines, date, preview, duration for videos, source, permalink, partner mark), whatever network it came from.
- An administrator with the 047 `platform_admin` role creates, edits, publishes and unpublishes platform materials in the admin, and nobody without that role can.
- The source list is kept in the admin; only accounts listed there feed the site, each bound to one connected network; the starting networks are Telegram, VK / VK Видео, RuTube and Dzen, read from the BBM Academy accounts listed in «Source connectors».
- Each network is a separate connector; adding one changes neither the rail, nor the visitor's flow, nor the materials already in the feed.
- Slice 1 ships with own materials only and is complete without any network connector.
- New publications of a listed account reach the feed without manual copying, within a bounded delay. _(Delay value — agent-proposed — UNCONFIRMED: about an hour is enough for a news rail; push-based connectors deliver sooner; set at spec time.)_
- Every card opens its material: a platform material on its Academy page, an external one — post or video — on its platform in a new tab; nothing plays inside the Academy.
- Only card data is stored: no video files, no mirrored network-hosted media; a retention period for stored card data is set in the design spec.
- An unpublished, hidden or switched-off material never shows on the site.
- One failing external platform never breaks the rail.
- The rail, the reading page and the admin section are usable on a phone and pass the platform accessibility bar (`playwright-axe`).

## Out of scope

- The 029 home page itself and the placement of the rail on it — feature 029.
- Experts writing their own columns in a cabinet (REQ-124 in full) — a later 048 slice; in this feature the team enters columns in the admin on the expert's behalf. Linking a column author to the expert's personal page — `blocked_by` **031** (expert page).
- Publishing from the platform to the social networks (cross-posting) — the feed only reads. The Dzen fallback (Dzen imports the Academy's RSS) is Dzen's own documented import, not cross-posting by the platform.
- Embedded video players — videos open on their platform.
- Reading any platform's web pages by scraping.
- YouTube (blocked in the RF; marketing: «нет, пока»), Threads, TikTok and Pinterest — not in the starting set; each can return later as a connector if marketing names it. Instagram stays an open question; Max may come later (marketing).
- Payload CMS (`apps/cms`) as the place where materials are written — not used: materials are platform domain data, ADR-0004 §10.1 keeps Payload to marketing content and forbids it to own domain data, and `apps/cms` is a reserved empty scaffold; materials are written in `apps/admin` (Flows — Platform material, step 1).
- Comments, likes, view counters, subscriptions to the feed.
- A feed on the doctor storefront `doctor.school`; a full «all news» archive page. _(agent-proposed — UNCONFIRMED.)_
- Roles narrower than `platform_admin` (e.g. an editor) — feature 039.

## Open questions

- **Own materials (slice 1)** — «Предварительно да» (owner, [#3403 comment 6490905025](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6490905025)): own materials stay and slice 1 is built as described, but the answer is preliminary — the final confirmation of the Academy's own blog is still to come. _(owner — final confirmation of the own blog.)_
- **Instagram** — the BBM Academy account `@bbm.academy` exists, the network is blocked in the RF; whether it joins the feed stays open. The connector model (US-10) means the answer adds a slice, not a feature change. _(owner.)_
- **RuTube** — written confirmation of the channel-list endpoint (blocks slice 4). _(Маркетинг sends the letter.)_
- **Dzen** — permission under ToS §5.1, or the reverse RSS path (decides the shape of slice 5). _(Маркетинг sends the letter.)_
- **VK clips** — no documented read route; settled when slice 3 is designed. _(lead — design.)_

## Approved-mockup reference

Empty — filled at Stage A (`author-design-mockup`). Pending canvases:

- `academy-material.dc.html` — the reading page of a platform material (US-8); Claude Design prompt: [#3403 comment 6487221951](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6487221951) (prompt 2).
- `unit-feed-card.dc.html` — the feed card unit, and the rail on the Academy home; Claude Design prompt: [#3403 comment 6487273524](https://github.com/doctor-school/ds-platform/issues/3403#issuecomment-6487273524).

Superseded input: the «Новости и блог» and «Рилсы и видео» blocks of [`design-source/academy-home.dc.html`](../../../../../../design-source/academy-home.dc.html) — the rail replaces both; only their loading / empty / error copy is carried until the rail canvas exists. The admin materials and sources screens have no canvas yet.

## Prior art

- [`048-platform-access-research.md`](./048-platform-access-research.md) — primary-source research (2026-10-29) on server-side read access to our own accounts on Telegram, VK / VK Видео, RuTube, Dzen and YouTube: mechanism, auth, fields, limits, terms, embeds.
- 013 PRD US-4 («the academy's own media — podcast / discussions») — the home media block this feed now supplies.
- 012 admin list compositions — reused for the admin lists of materials and sources (functional map row 048).
- The legacy source system had no mixed feed; the Bubble export is not a template.
