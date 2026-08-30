import type { EligibleExpertUserOption } from "@/providers/data-provider";

/** Avoid invalidating a settled page when closing an already-empty search. */
export function shouldStartEligibleExpertUserSearch(
  currentQuery: string,
  nextQuery: string,
): boolean {
  return currentQuery !== nextQuery;
}

/** Append one explicitly requested server page without duplicating a User. */
export function mergeEligibleExpertUserPages(
  current: EligibleExpertUserOption[],
  next: EligibleExpertUserOption[],
): EligibleExpertUserOption[] {
  const seen = new Set(current.map((user) => user.id));
  return [
    ...current,
    ...next.filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    }),
  ];
}

/** Keep the selected label visible while the current search returns other rows. */
export function includeSelectedEligibleExpertUser(
  users: EligibleExpertUserOption[],
  selected: EligibleExpertUserOption | null,
): EligibleExpertUserOption[] {
  if (!selected || users.some((user) => user.id === selected.id)) return users;
  return [selected, ...users];
}
