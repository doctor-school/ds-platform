---
title: "Feature 025 — The attention points engine: accrual, spend and gating (PRD)"
description: "Product requirements for the one points account a doctor holds across the doctor storefront, the Academy and the mobile app: three units (Pul — the only spendable one; Bre — reputation; Con — awareness), the earn rules and their defaults, spending Pul on live events through a reserve that is debited only on confirmed attendance, one advance rule per event for every doctor, gating modes per content item, the consented monthly leaderboard, the copy model that keeps «бесплатно для врача» a money statement, anti-farming and the compliance guardrails. Every number is a configurable parameter and every posting records its rule version. Backend-only: the consumers 018, 020, 021, 022, 024 and 036 own the surfaces. Wave 2; source of the 025 EARS triplet (ADR-0014)."
slug: two-site-ia-025-attention-points-engine-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: backend-only
storefronts: none
storefronts_reason: "The engine has no screen of its own: every surface that shows a balance, a price, an advance or a leaderboard belongs to a consumer feature (020 event page, 021 registration, 022 doctor account, 024 learning module, 018 feed, the mobile app). One account serves both storefronts and the app (OWD-10), so the engine is storefront-neutral by construction."
lang: en
---

> **EN (this)** · **RU:** [`025-product-ru.md`](./025-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **Wave 2** (022, 023, 024, 025, 044). 025 has no `blocked_by`; 020, 022 and 024 depend on it. Domain canon: [ADR-0016](../../../adr/0016-core-domain-model-en.md) §6 (points and money are one append-only ledger family) and [ADR-0003](../../../adr/0003-data-layer-stack-en.md) (`event_id` dedupe, immutability). Discovery record: Issue #1794 («Discovery decisions (owner, 2026-11-06)»). Research record: [attention points — legacy and research recon](../../product/attention-points/legacy-recon.md) — sources, contradictions and compliance findings live there and are not repeated here.

**Provenance legend.** **[owner]** — decided by the owner (Issue #1794, «Discovery decisions (owner, 2026-11-06)»; copy model of 2026-11-05). **[PL]** — a fixed fact stated by the Product Lead, not open to redesign in this feature. **[lead-proposed]** — proposed by the agent lead at the owner's request; these are the PRD's defaults and, like every number here, are configurable parameters [owner]. **[canon]** — already decided in an ADR or an approved spec.

## Feature summary

Every doctor holds **one points account** for the doctor storefront, the Academy and the mobile application [PL; OWD-10]. It carries three units [PL]:

- **Pul** — the only spendable unit. It opens access to live events and is **never exchangeable to money** or to anything outside the platform.
- **Bre** — reputation: contribution to the community and to learning.
- **Con** — awareness: depth of mastery. Con **only grows**. The fixed rate **1 Con = 2 Bre** is a weight (leaderboard, B2B attention reporting).

There are **no penalties** and **no repeat award for the same content** [PL]. Points are earned, never bought; the doctor never pays money for anything on the platform.

The engine is a **ledger, not a balance column** [canon, ADR-0016 §6]: every movement is an append-only posting; a balance is computed from postings; a correction is a compensating posting (`reverses_posting_id`), never an edit. **Every accrual, price, cap and formula is a configurable parameter with a default, and every posting records the version of the rule that produced it** [owner], so a doctor's balance and a sponsor's attention report stay reconcilable after any re-tuning.

The loop at launch [lead-proposed]: **lessons and modules are the source of Pul; live events are the sink of Pul; confirmed participation is a source of Bre and Con.** Pul is reserved when the doctor signs up for an event and debited only when attendance is confirmed; a cancel, a no-show or an event cancelled by the platform releases the reserve. So there is no negative balance and no refund procedure. The **advance** is a property of the event — one rule for every doctor [owner].

## The three units

| Unit | Role                  | Spendable                                   | Direction                            | Accrues for                                                                |
| ---- | --------------------- | ------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| Pul  | access to live events | yes — events only at launch [lead-proposed] | grows and is spent; never below zero | learning (lessons, modules), registration, profile, referrals              |
| Bre  | reputation            | no                                          | grows                                | contribution: profile, questions, ratings, interactive, referrals, lessons |
| Con  | awareness             | no                                          | only grows [PL]                      | depth: completed modules, confirmed participation                          |

Bre and Con accrue **from day one** for contribution and depth, **not for the Pul spent** [lead-proposed]: raising an event's price must not raise a doctor's status. Bre and Con also accrue for offline and open learning; Pul only for online learning [PL]. The account shows all three units [PL].

## Earn rules (defaults, all configurable)

Every value below is a parameter with a default [owner]; the numbers are [lead-proposed]. The anchor: the registration grant plus the profile action (20 + 30) covers one standard event (50).

| Action                                                              | Pul | Bre | Con | Condition / cap                                                                             |
| ------------------------------------------------------------------- | --- | --- | --- | ------------------------------------------------------------------------------------------- |
| Registration, phone verified                                        | +20 | —   | —   | once per person; usable only after phone verification                                       |
| Profile completed and verified                                      | +30 | +2  | —   | once                                                                                        |
| Lesson completed (024 completion status, not «scrolled to the end») | +10 | +1  | —   | once per lesson; mistakes never remove points                                               |
| Module completed (all lessons + test passed)                        | +20 | +3  | +1  | once per module                                                                             |
| Event participation confirmed by presence                           | 0   | +2  | +1  | same at any price, open events included                                                     |
| Question to the speaker                                             | —   | +1  | —   | at most once per event                                                                      |
| Event rating / feedback                                             | —   | +1  | —   | once per event                                                                              |
| Interactive reaction during a live event (poll, presence check)     | —   | +1  | —   | at most once per event                                                                      |
| Referral — the inviter                                              | +30 | +2  | —   | after the invitee's verified phone and first completed lesson; at most 5 per calendar month |
| Referral — the invitee                                              | +30 | —   | —   | the same condition                                                                          |
| Podcast outside a lesson                                            | 0   | 0   | 0   | points come only with the lesson it belongs to [PL]                                         |

An event never accrues Pul, open events included [PL]: otherwise the sink becomes a source.

## Spending, gating and the advance

**What costs Pul.** At launch Pul is spent **only on live events** (broadcasts, webinars; later seats with a limited number of places). **Lessons earn Pul and never cost Pul** [lead-proposed; consistent with 024 D10 «doctors buy nothing» and 023 «no price» on learning screens]. Default prices: a standard event 50 Pul, a premium or limited-seat event 100 Pul [lead-proposed]. An НМО-accredited event is always **open** [lead-proposed; compliance].

**Gating modes.** The admin sets each content item to one of three modes, as a drop-off experiment [PL]:

- **Open** — nothing is reserved or debited; registration is still required (REQ-20).
- **Advance** — price N Pul; if the doctor has less, the advance covers the shortfall and access opens at once, with no «not enough» message.
- **Threshold** — price N Pul; if the doctor has less, they see the way to earn the difference.

At launch a lesson can be set to **Open** only [lead-proposed]; podcasts may enter the gating experiment but default to open.

**One advance rule for every doctor** [owner]. The advance is a **per-event flag** and is the same for every doctor. A medrep or partner link **records the arrival source only** — it never grants a per-doctor advance and never switches an event from threshold to advance for one doctor. This supersedes the per-arrival reading of REQ-49 and of spec 020; 020 and 021 are aligned in #3801.

**Reserve, debit on attendance, release** [lead-proposed]:

1. On sign-up the price is **reserved** (covered by the balance, by the advance, or both).
2. When attendance is **confirmed by presence** (a configurable share of the event's duration, default 30 %, from server-side presence beats) the reserve is **debited**.
3. A cancel by the doctor at any time, a cancel or reschedule by the platform, and a no-show **release** the reserve by a compensating posting. On a no-show only the participation Bre/Con are not accrued; an advance used for that event is annulled together with its obligation.
4. At most **3 concurrent reserves on limited-seat events** per doctor, plus a waiting list [lead-proposed].

**The advance as an obligation, never a minus** [lead-proposed]. An advance is a posting of exactly the shortfall plus an open obligation «to be earned back». Future Pul earnings first settle the obligation. The balance is **never shown as negative**; the doctor sees progress («opened in advance · 30 Pul left to earn»). Open advances are capped at **150 Pul per doctor** (counted per person, not per device); above the cap the event behaves as threshold for that doctor. An unsettled advance has no consequence except that no new advance beyond the cap is available; **it never blocks access** to open events or lessons. An advance is not transferable and is spent only on its own event.

**No negative balance, no expiry** [lead-proposed]. Pul does not expire at launch.

## Leaderboard and consent

- **Score** = **2·Con + Bre earned in the calendar month**, within a **specialty** [lead-proposed]. The Pul balance **never ranks** — ranking by balance would punish spending, and ranking by a sponsor-funded unit reads as competition for sponsor value. A lifetime total is not used.
- **View** [lead-proposed]: the top 10 of the doctor's specialty plus the doctor's own position with five neighbours above and below; the block is presented as «active doctors of the specialty», not as a contest; no rewards for places.
- **Consent** [lead-proposed; 152-FZ art. 10.1]: appearing on the leaderboard needs a **separate consent to dissemination**, off by default, never a clause of the user agreement. The doctor picks surname with initials or a pseudonym and separately whether to show city and photo. Withdrawal removes the row at once. The doctor always sees their own position privately. Ranks are computed among consenting doctors only, so hidden doctors cannot be inferred from place numbers.

## Copy model

[owner, 2026-11-05]

- **«Бесплатно для врача»** is a statement about **money**: the doctor never pays money. It is always true and allowed at platform level and on any event.
- **«Бесплатно» never describes a Pul price** or a zero-Pul state. A Pul cost line is shown **only when the cost is > 0**; a zero-Pul event shows no price line.
- Platform points are **never called «баллы»** in the НМО sense, never summed with НМО credits and never converted to them; an НМО badge, when present, is a separate statement.
- The advance is never called «кредит», «долг» or «минус»; a reserve is described as «will be counted after participation», not «will be debited» [lead-proposed].

**Consumer requirement (020).** Today the event page's «Бесплатно для врача» line is wired to `pulCost === 0`, and `eventEconomyFacts()` returns `pulCost: 0` for every event (`DEBT.md`). When events get real Pul prices from this engine, that line must become an **independent money statement** shown on every event, next to a separate «N Pul» line when the cost is > 0. Tracked in #3801.

## Anti-farming

[lead-proposed]

- **No repeat award for the same content** [PL]: the dedupe key is **(doctor, content item, action)** across every storefront, the Academy and the mobile app's offline sync — not a client event id alone. The mobile app shows pending credits as «being credited» until the server confirms them.
- **Lesson credit needs attention evidence**: watch time or a passed test, through 024's computed completion status; event credit uses server-side presence.
- **Referral farming**: credit only after the invitee's verified phone and first completed lesson, at most 5 per month.
- **Multi-account farming**: Pul usable only after phone verification; the advance cap counts per person.
- **Caps only on non-learning sources** (questions, ratings, reactions, referrals); learning itself is never capped — more attention is the value sold.
- **Manual correction** by an admin is a compensating posting with an audit record, never an edit of a posting.

## Compliance guardrails

Product constraints, **to be confirmed by a lawyer** before launch:

- **323-FZ art. 74** (no gifts or money to a doctor from a pharma company or its representative; no de-minimis threshold): Pul is issued by the platform under one rule set for every doctor; it opens only access to education; there are **no merch, gift, travel or entertainment sinks**; no money equivalent is ever shown; medreps and sponsors neither see nor change individual balances; **no sponsor-funded per-doctor value**; no rule depends on prescriptions or sales.
- **AIPM Code** (indirect transfers of value disclosed by name): a per-doctor benefit known to a sponsor is a named-disclosure risk — the reason the advance is per event, not per link.
- **НМО**: sponsor content stays **outside НМО**; an НМО-accredited event is always open and carries no promotion.
- **152-FZ**: a **separate consent** for leaderboard display (art. 10.1) and a **separate consent** for any named sponsor report (art. 9, a separate document); sponsor reports are **aggregates by default**.
- At launch there is **no Pul for watching partner or promotional content**.

## Consumer contract

| Consumer                     | What it takes from 025                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **021** registration         | registration and profile accruals; the `PointsCredited` fact; arrival source recorded as attribution only, never an advance                                               |
| **020** event page           | the event's Pul price and gating mode, the doctor's balance and open advance, reserve on sign-up, release on cancel; the money line decoupled from `pulCost` (copy model) |
| **024** learning module      | consumes 024's learning facts and computed statuses (element, lesson, module done, test passed) as accrual events; lessons carry no Pul price                             |
| **022** doctor account       | the three balances, the open advance and its remaining obligation, the posting history in the doctor's words                                                              |
| **018** feed / specialty     | the consented monthly leaderboard per specialty; a card's Pul cost line only when > 0                                                                                     |
| **036** attention aggregates | aggregates per project and per sponsor from postings, each posting with its rule version; named data only under a separate consent                                        |

## User stories

- **US-1** — As a **doctor**, I have **one points account** — the same Pul, Bre and Con on the doctor site, in the Academy and in the mobile app.
- **US-2** — As a **doctor**, I **earn Pul** for registering with a verified phone, completing my profile, completing lessons and modules and inviting colleagues, so I can join live events.
- **US-3** — As a **doctor**, I **earn Bre and Con** for my contribution and the depth of my learning, never for the Pul I spent.
- **US-4** — As a **doctor**, I am **never awarded twice** for the same content, whichever storefront or device I use, and **never lose points** for a mistake.
- **US-5** — As a **doctor**, when I sign up for an event that costs Pul, the price is **reserved** and counted only after I actually attended; if I cancel, do not come, or the event is cancelled, the reserve is released with no consequence.
- **US-6** — As a **doctor** without enough Pul for an **advance-mode** event, I simply sign up — no «not enough» message — and I see how much is left to earn back, never a minus.
- **US-7** — As a **doctor** without enough Pul for a **threshold-mode** event, I see how many Pul I still need and the learning that earns them.
- **US-8** — As a **doctor who arrived by a medrep or partner link**, I get exactly the same conditions as every other doctor on that event.
- **US-9** — As a **doctor**, I see the monthly **«active doctors of my specialty»** only if I gave a separate consent, choose how I am named, and can withdraw at once; my own position is always visible to me privately.
- **US-10** — As a **doctor**, the interface tells me honestly that the platform costs **no money**, never calls a Pul price «бесплатно» and never mixes points with НМО credits.
- **US-11** — As a **Product Lead**, I set each content item to **open / advance / threshold** and change any accrual, price, cap or formula **without a release**, as an experiment.
- **US-12** — As a **Product Lead**, every posting records the **rule version** that produced it, so I can compare experiments and reconcile reports after re-tuning.
- **US-13** — As an **admin**, I correct a wrong accrual with a **compensating posting** that leaves an audit record; nothing is ever edited or deleted.
- **US-14** — As a **sponsor-facing analyst** (feature 036), I receive **attention aggregates** per project built from postings, named data only where the doctor consented separately.
- **US-15** — As a **consumer feature** (018, 020, 021, 022, 024), I read balances, prices, gating decisions and the leaderboard from one engine and post the facts it accrues on, without owning any points logic.

## Flows

**Registration to the first event (US-2, US-5):** a doctor registers and verifies the phone → +20 Pul → completes the profile → +30 Pul, +2 Bre → signs up for a 50 Pul event → 50 Pul reserved → attends past the presence threshold → 50 Pul debited, +2 Bre, +1 Con.

**Advance (US-6, US-8):** a doctor with 20 Pul signs up for a 50 Pul advance-mode event → 20 Pul reserved from the balance, 30 Pul covered by an advance with a 30 Pul obligation → the doctor sees «opened in advance · 30 Pul left to earn» → attends → the reserve is debited → the next lesson's +10 Pul settles 10 of the obligation. A doctor who arrived by a medrep link goes through the same steps.

**Threshold (US-7):** a doctor with 30 Pul opens a 50 Pul threshold-mode event → «20 more Pul needed — complete 2 lessons» with a link to lessons → after two lessons the doctor signs up.

**Release (US-5):** a signed-up doctor cancels, does not attend, or the platform cancels the event → a compensating posting releases the reserve; an advance used for it is annulled with its obligation; no participation Bre/Con.

**Advance cap:** a doctor with 150 Pul of open obligations opens another advance-mode event → it behaves as threshold for this doctor; open events and lessons stay open.

**Re-tuning (US-11, US-12):** the Product Lead changes the lesson award from 10 to 15 Pul → new postings carry the new rule version; past postings keep theirs; balances are not rewritten.

## Product acceptance criteria (draft)

- One account per doctor across the doctor storefront, the Academy and the mobile app [PL; OWD-10].
- Three units with the roles above; Pul is the only spendable unit and is never exchangeable to money; Con only grows; 1 Con = 2 Bre as a weight; no penalties [PL].
- The balance is computed from append-only postings; corrections are compensating postings; each posting records its rule and rule version [canon; owner].
- Every accrual, price, cap and formula is a parameter with a default, changeable without a release [owner]; the defaults are the tables above [lead-proposed].
- The same (doctor, content item, action) is accrued at most once across storefronts and offline sync [PL; lead-proposed key].
- Pul is spent only on events at launch; lessons never cost Pul [lead-proposed].
- Sign-up reserves, confirmed attendance debits, cancel / no-show / event cancel release; the balance never goes below zero; Pul does not expire [lead-proposed].
- The advance is a per-event flag, identical for every doctor; an arrival link records attribution only [owner]. Open advances are capped (default 150 Pul per person), settled from future earnings, never shown as a minus, never block access [lead-proposed].
- The leaderboard ranks 2·Con + Bre earned in the calendar month within a specialty, among doctors with a separate consent; the Pul balance never ranks [lead-proposed].
- Copy: «бесплатно для врача» is a money statement; a Pul cost line only when > 0; points are never «баллы» and never combined with НМО [owner].
- The compliance guardrails above hold as product constraints pending legal confirmation.

## Out of scope

- **Screens** — every balance, price, advance and leaderboard surface belongs to its consumer (020, 021, 022, 024, 018, the mobile app).
- **Money** — sponsor billing, invoices and the money side of attention aggregates are feature **036**.
- **Next-wave sinks** — small-group seats, a priority question to an expert, early access to a recording; never merch, travel, internships or entertainment without prior legal review.
- **Pul for partner or promotional content**, an advertising coefficient — not at launch.
- **Admin anomaly analytics** beyond manual compensating corrections — a later iteration.

## Open questions

For the Product Lead — nothing else is open:

1. **Con↔Bre exchange visible to the doctor**, or 1 Con = 2 Bre only as a weight for the leaderboard and reporting. Default here: a weight only, no doctor-facing exchange at launch.
2. **Sponsor billing weights** of Con, Bre and Pul in the attention formula (036). Default here: record the rule version on every posting so any weighting can be recomputed.

## Capability owner

No row exists yet in [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md) for the points ledger. One shared backend module owns the ledger, the rules and the gating decision; consumers read it through the API. The registry row is added when the EARS triplet is authored, not in this PRD.
