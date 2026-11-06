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
