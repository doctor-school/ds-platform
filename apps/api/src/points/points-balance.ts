import type { PointsPostingLeg } from "@ds/schemas";

// EARS-22 — the overdraw rule as a pure function, so the arithmetic is unit
// tested apart from the transaction that feeds it. A balance is a fold
// `Σ credits − Σ debits` per (account, denomination); the ledger refuses any
// leg that would take a PERSON account's available Pul below zero. System
// accounts (issuance, reserve, sink, advance) are counter-accounts and may run
// negative by construction — issuance is the source of every credit.

/** A fact leg with its account refs already resolved to account ids. */
export interface ResolvedLeg {
  leg: PointsPostingLeg["leg"];
  denomination: PointsPostingLeg["denomination"];
  amount: number;
  debitAccountId: string;
  creditAccountId: string;
}

/**
 * Applies the fact's legs in order to the person accounts' current Pul
 * balances and returns the first leg that would take one below zero, or null
 * when every leg keeps every person account at or above zero.
 *
 * @param pulBalances current folded Pul per person account id (the accounts
 *   the caller has locked); an account absent from the map is not a person
 *   account and is not checked.
 */
export function firstOverdrawingLeg(
  pulBalances: ReadonlyMap<string, number>,
  legs: readonly ResolvedLeg[],
): ResolvedLeg | null {
  const running = new Map(pulBalances);
  for (const leg of legs) {
    if (leg.denomination !== "pul") continue;
    const credit = running.get(leg.creditAccountId);
    if (credit !== undefined)
      running.set(leg.creditAccountId, credit + leg.amount);
    const debit = running.get(leg.debitAccountId);
    if (debit !== undefined) {
      const next = debit - leg.amount;
      if (next < 0) return leg;
      running.set(leg.debitAccountId, next);
    }
  }
  return null;
}

/** The posting fields the `PointsAccount` fold reads (025 EARS-2). */
export interface FoldPosting {
  eventId: string;
  leg: string;
  debitAccountId: string;
  creditAccountId: string;
  denomination: PointsPostingLeg["denomination"];
  amount: number;
  occurredAt: Date;
}

/** The amounts of `PointsAccount` (025 EARS-2), before identity and status. */
export interface PointsAccountFold {
  pul: { available: number; reserved: number };
  bre: number;
  con: number;
  advance: { open: number; remaining: number };
}

// Derived fact ids and leg names of the reserve lifecycle (025-design §2/§5):
// reserve `reserve:<registration>` (legs `reserve:balance` person→reserve,
// `reserve:advance` advance→reserve), settle `settle:<registration>`, release
// `release:<registration>`; later Pul accruals net the obligation with leg
// `obligation-settle:pul` person→advance (§4). One definition, shared by this
// fold, the ledger's posting fetch and the reserve writers (#3810, #3811).
export const RESERVE_FACT = "reserve:";
export const SETTLE_FACT = "settle:";
export const RELEASE_FACT = "release:";
export const RESERVE_BALANCE_LEG = "reserve:balance";
export const RESERVE_ADVANCE_LEG = "reserve:advance";
export const OBLIGATION_SETTLE_LEG = "obligation-settle:pul";

/**
 * EARS-2 — the `PointsAccount` amounts as a pure fold over postings; no
 * balance is stored anywhere.
 *
 *  - available, per denomination: Σ credits − Σ debits of the person account;
 *  - `pul.reserved`: the person's own Pul (`reserve:balance`) held by every
 *    reserve fact with no settle or release fact for its registration yet;
 *  - `advance`: each reserve fact that is not released opens an obligation of
 *    its `reserve:advance` amount; the person's `obligation-settle:pul`
 *    postings net them oldest first; `open` counts the obligations not fully
 *    netted, `remaining` sums what is still owed.
 *
 * @param postings every posting that debits or credits the account, plus the
 *   postings of the reserve, settle and release facts of the person's reserves
 *   (their `reserve:advance` / settle legs do not name the person account).
 */
export function foldPointsAccount(
  accountId: string,
  postings: readonly FoldPosting[],
): PointsAccountFold {
  const balance = { pul: 0, bre: 0, con: 0 };
  const eventIds = new Set(postings.map((p) => p.eventId));
  const reserves = new Map<
    string,
    { at: Date; balance: number; advance: number; mine: boolean }
  >();
  let netted = 0;

  for (const p of postings) {
    if (p.creditAccountId === accountId) balance[p.denomination] += p.amount;
    if (p.debitAccountId === accountId) balance[p.denomination] -= p.amount;
    if (p.debitAccountId === accountId && p.leg === OBLIGATION_SETTLE_LEG)
      netted += p.amount;
    if (!p.eventId.startsWith(RESERVE_FACT)) continue;
    const reserve = reserves.get(p.eventId) ?? {
      at: p.occurredAt,
      balance: 0,
      advance: 0,
      mine: false,
    };
    if (p.leg === RESERVE_BALANCE_LEG && p.debitAccountId === accountId) {
      reserve.balance += p.amount;
      reserve.mine = true;
    }
    if (p.leg === RESERVE_ADVANCE_LEG) reserve.advance += p.amount;
    reserves.set(p.eventId, reserve);
  }

  let reserved = 0;
  const obligations: Array<{ at: Date; amount: number }> = [];
  for (const [eventId, reserve] of reserves) {
    if (!reserve.mine) continue;
    const registration = eventId.slice(RESERVE_FACT.length);
    const released = eventIds.has(RELEASE_FACT + registration);
    const settled = eventIds.has(SETTLE_FACT + registration);
    if (!released && !settled) reserved += reserve.balance;
    if (!released && reserve.advance > 0)
      obligations.push({ at: reserve.at, amount: reserve.advance });
  }

  obligations.sort((a, b) => a.at.getTime() - b.at.getTime());
  let open = 0;
  let remaining = 0;
  for (const obligation of obligations) {
    const covered = Math.min(netted, obligation.amount);
    netted -= covered;
    if (obligation.amount > covered) {
      open += 1;
      remaining += obligation.amount - covered;
    }
  }

  return {
    pul: { available: balance.pul, reserved },
    bre: balance.bre,
    con: balance.con,
    advance: { open, remaining },
  };
}
