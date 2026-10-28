---
title: "Feature 048 — Materials feed: platform news and external sources (PRD)"
description: "Product requirements for the Academy materials feed: one mixed feed of news and columns authored on the platform in the admin plus materials pulled from the official Doctor.School / Academy accounts on external platforms (Telegram, VK, Dzen, RuTube, YouTube; the set of platforms is extensible). It feeds the «Новости и блог» and «Рилсы и видео» blocks of the Academy home (029). Source of the 048 EARS triplet (ADR-0014)."
slug: two-site-ia-048-materials-feed-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`048-product-ru.md`](./048-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · Functional-map registry row 048 (`apps/docs/content/specs/product/two-site-ia/functional-map-ru.md` §B). Owner decisions of 2026-10-28 are recorded on [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions». Anything this PRD adds beyond those decisions is marked `agent-proposed — UNCONFIRMED`.

## Feature summary

The Academy home (029) carries two content blocks the platform cannot fill today: **«Новости и блог»** and **«Рилсы и видео»**. The owner decided (2026-10-28) that both read **one mixed feed of materials**: news written on the platform and kept in the admin, plus materials published on the **official** Doctor.School / Academy accounts on other platforms — a Telegram channel, VK, Dzen and the video platforms RuTube and YouTube. Video platforms supply both news and «Рилсы и видео». Only official accounts appear, and the admin keeps their list. The set of platforms is **open**: marketing may name more, and adding one is a new source kind, not a rework of the page.

Under the owner's governing principle for this cascade — «не городить временные костыли … сразу делать нормально» — every material on the home comes from this real, admin-managed feed: no hand-set tiles, no placeholder that is replaced later.

The feed is a shared capability: the 029 home blocks only read it. Its capability owner is a new row in [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md), registered when the design spec is written (ADR-0013 §A1). Storefront affiliation (ADR-0016 §8): materials — `академия`; sources — `только админка`.

## User stories

- **US-1** — As a **platform administrator**, I write a news item or an expert column in the admin, preview it and publish it, so the Academy can say something on its own site without posting it elsewhere first.
- **US-2** — As a **platform administrator**, I edit or unpublish a platform material I published, and the change shows on the site without a release.
- **US-3** — As a **platform administrator**, I keep the list of official accounts the feed reads: for each account I set its platform, its address and which feeds it supplies (news, video or both), and I can switch an account off without deleting what it already brought in. _(Per-account feed choice — agent-proposed — UNCONFIRMED.)_
- **US-4** — As a **platform administrator**, materials published on the connected accounts appear in the feed by themselves; nobody copies posts into the admin by hand.
- **US-5** — As a **platform administrator**, I can hide one specific external material from the feed (an off-topic or outdated post) without switching off the whole account. _(agent-proposed — UNCONFIRMED.)_
- **US-6** — As an **Academy visitor**, the «Новости и блог» block shows the latest materials of all kinds mixed together, newest first; each entry tells me its type (news, expert column, social post), its title and who published it and when, and opens the material.
- **US-7** — As an **Academy visitor**, the «Рилсы и видео» block shows the latest short videos from the official video accounts as preview tiles with duration, title and platform; a tile takes me to the video on its platform (canvas default, variant Б).
- **US-8** — As an **Academy visitor**, I open a platform-authored news item or column and read it on the Academy itself. _(agent-proposed — UNCONFIRMED: a platform material otherwise has nowhere to link; see Open questions.)_
- **US-9** — As an **Academy visitor**, while the feed is loading, when there is nothing in it yet, or when it could not be loaded, the blocks tell me so honestly and let me retry — never a fake entry, never a blank hole.
- **US-10** — As a **product owner**, when marketing names a new platform, it joins the feed as a new source kind next to the existing ones, without redesigning the home blocks or migrating materials already in the feed.

## Flows

**Platform material (US-1, US-2, US-6, US-8):**

1. The administrator opens the materials section of the admin (047 access: role `platform_admin`, admin session with TOTP per 011) and creates a material: type (news / expert column), title, text, cover image (optional), author line. For an expert column the author is chosen from the experts directory (012). _(Field set — agent-proposed — UNCONFIRMED.)_
2. The administrator previews and publishes it; it appears at the top of «Новости и блог» on the Academy home.
3. A visitor taps the entry → reads the material on its Academy page.
4. The administrator edits or unpublishes it → the site reflects the change; an unpublished material disappears from the blocks and its page stops being public.

**External source (US-3, US-4, US-5, US-7):**

1. The administrator adds an official account: platform (Telegram, VK, Dzen, RuTube, YouTube), its address, which feeds it supplies.
2. New publications of that account appear in the feed automatically — posts in «Новости и блог» as type «Соцсети», videos in «Рилсы и видео». Entries keep the platform's own publication date.
3. A visitor taps an external entry → the material opens on its platform in a new tab.
4. The administrator hides an unwanted post → it leaves the blocks; switching an account off stops new materials from it and removes its materials from the blocks, without deleting them from the admin. _(agent-proposed — UNCONFIRMED.)_

**Branches:**

- **A platform is temporarily unreachable** → the feed keeps showing what it already has from that account and the rest of the feed; the visitor sees no error for a single source. _(agent-proposed — UNCONFIRMED.)_
- **The whole feed cannot be read** → «Новости и блог» shows the canvas error state «Не удалось загрузить новости.» with «Повторить».
- **The feed is empty** → «Новости и блог» shows the canvas empty state («Записей пока нет. Здесь появятся колонки экспертов и новости проектов.»). «Рилсы и видео» has no empty or error state in the canvas; the proposal is that the block is not shown until it has videos. _(agent-proposed — UNCONFIRMED; Stage A confirms.)_
- **A source account is removed by its platform or renamed** → the administrator sees the account as failing in the source list. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- One feed holds platform-authored materials and materials from external official accounts; the 029 blocks read it and hold no materials of their own.
- An administrator with the 047 `platform_admin` role creates, edits, publishes and unpublishes platform materials in the admin, and nobody without that role can.
- The source list is kept in the admin; only accounts listed there feed the site, each with a platform kind from an open set; the starting kinds are Telegram, VK, Dzen, RuTube and YouTube.
- Adding a new platform kind does not change the home blocks, the visitor's flow or materials already in the feed.
- New publications of a listed account reach the feed without manual copying, within a bounded delay. _(Delay value — agent-proposed — UNCONFIRMED: about an hour is enough for a news block; set at spec time.)_
- «Новости и блог» shows the latest materials of every kind mixed, newest first, each with type, title and a «who · when» line, in the canvas loading, empty, error and data states.
- «Рилсы и видео» shows video preview tiles (duration, title, platform, link out — canvas variant Б).
- Every entry opens its material: a platform material on its Academy page, an external one on its platform.
- An unpublished, hidden or switched-off material never shows on the site.
- One failing external platform never breaks the blocks.
- Blocks and the admin section are usable on a phone and pass the platform accessibility bar (`playwright-axe`).

## Out of scope

- The 029 home page itself and the placement of the blocks — feature 029.
- Experts writing their own columns in a cabinet (REQ-124 in full) — later; in this feature the team enters columns in the admin. _(agent-proposed — UNCONFIRMED.)_ Linking a column author to the expert's personal page — `blocked_by` **031** (expert page).
- Publishing from the platform to the social networks (cross-posting) — the feed only reads.
- Comments, likes, view counters, subscriptions to the feed.
- A feed on the doctor storefront `doctor.school`; a full «all news» archive page. _(agent-proposed — UNCONFIRMED.)_
- Embedded video players (canvas variants А and В) — the canvas default is variant Б.
- Roles narrower than `platform_admin` (e.g. an editor) — feature 039.

## Open questions

- **Final platform list** — the owner is checking with marketing (#1799). The starting set is Telegram, VK, Dzen, RuTube, YouTube; the canvas reels caption also names «VK Видео».
- **Platform material page** — does a news item or column written on the platform get its own reading page on the Academy (US-8), or is every platform material also published on a social account and the entry links there? _(owner — product.)_
- **Who writes expert columns** — the team on the expert's behalf (this PRD's proposal) or the expert themself later? _(owner — product.)_
- **Moderation** — is hiding single external posts (US-5) needed, given only official accounts are read? _(owner — product.)_
- Per-platform access (API keys, terms of use for reading public posts) is checked at design time; a platform that cannot be read lawfully is reported back before it is designed.

## Approved-mockup reference

Empty — filled at Stage A (`author-design-mockup`). Input: the «Новости и блог» and «Рилсы и видео» blocks of [`design-source/academy-home.dc.html`](../../../../../../design-source/academy-home.dc.html) (news states loading / empty / error / data with type, title, by; reels variant Б). The admin materials and sources screens and the platform material page have no canvas yet.

## Prior art

- 013 PRD US-4 («the academy's own media — podcast / discussions») — the home media block this feed now supplies.
- 012 admin list compositions — reused for the admin lists of materials and sources (functional map row 048).
- The legacy source system had no mixed feed; the Bubble export is not a template.
