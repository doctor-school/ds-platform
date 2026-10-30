import type { OrganisationRoleRef } from "@ds/schemas";

/**
 * The pure half of the organisation form's role checkboxes (032 EARS-2): a role
 * the organisation already holds stays on its row, so a save never drops it.
 */

/**
 * Every ACTIVE role of the book, then every role the organisation already holds
 * (active or retired) that the book did not list — so a held role is offered,
 * ticked, even before the book arrives. A retired role it does not hold is not
 * offered: the server would refuse it.
 */
export function offeredRoles(
  book: readonly OrganisationRoleRef[],
  held: readonly OrganisationRoleRef[],
): OrganisationRoleRef[] {
  const offered = book.filter((role) => role.status === "active");
  const offeredIds = new Set(offered.map((role) => role.id));
  for (const role of held) {
    if (offeredIds.has(role.id)) continue;
    offeredIds.add(role.id);
    offered.push(role);
  }
  return offered;
}

/** The form saves only once the role book has loaded: a partial list would replace the set. */
export function rolesBookReady(query: {
  isLoading: boolean;
  isError: boolean;
}): boolean {
  return !query.isLoading && !query.isError;
}

/** The ticked ids in the offered order; an id the form does not offer is not sent. */
export function submittedRoleIds(
  offered: readonly OrganisationRoleRef[],
  ticked: readonly string[],
): string[] {
  return offered.map((role) => role.id).filter((id) => ticked.includes(id));
}
