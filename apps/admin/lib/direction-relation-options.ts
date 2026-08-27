"use client";

import { useCustom, useList } from "@refinedev/core";
import {
  ADMIN_LIST_PAGE_SIZE_MAX,
  type DirectionAdminListItem,
  type SpecialtyBook,
} from "@ds/schemas";
import type { DirectionSpecialtyOption } from "@/components/direction-specialty-form";

/**
 * The two option sets every #1483 relation screen picks from, loaded in ONE place
 * so the four pages agree on what an operator may choose and on how a choice is
 * labelled.
 *
 * Directions come from the admin book (`GET /v1/admin/directions`) with
 * `includeRetired` OFF: a retired direction is out of circulation, and offering
 * one as the endpoint of a NEW link would author a relation nobody can act on.
 * The existing rows of a retired direction stay readable — the list projection
 * carries its title regardless — so nothing is hidden, only un-authorable.
 *
 * Specialties come from the CLOSED public book (`GET /v1/public/specialties`,
 * #1479). There is deliberately no admin specialties resource: the Минздрав
 * nomenclature is not editorial content, and the same read that serves the doctor
 * serves the operator. The label pairs name and code («Кардиология (31.08.36)»)
 * because the nomenclature carries near-identical names that only the code tells
 * apart.
 */

export interface DirectionRelationOptions {
  directions: DirectionSpecialtyOption[];
  specialties: DirectionSpecialtyOption[];
  isLoading: boolean;
  isError: boolean;
}

/** Direction options alone — the adjacency screens need no specialty book. */
export function useDirectionOptions(): {
  directions: DirectionSpecialtyOption[];
  isLoading: boolean;
  isError: boolean;
} {
  const { result, query } = useList<DirectionAdminListItem>({
    resource: "directions",
    pagination: { currentPage: 1, pageSize: ADMIN_LIST_PAGE_SIZE_MAX },
  });

  return {
    directions: (result.data ?? []).map((row) => ({
      id: row.id,
      label: row.title,
    })),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** Directions plus the closed Минздрав book — the specialty-link screens. */
export function useDirectionRelationOptions(): DirectionRelationOptions {
  const directions = useDirectionOptions();
  const { result, query } = useCustom<SpecialtyBook>({
    url: "/v1/public/specialties",
    method: "get",
  });

  return {
    directions: directions.directions,
    specialties: (result.data?.entries ?? []).map((entry) => ({
      id: entry.id,
      label: `${entry.name} (${entry.code})`,
    })),
    isLoading: directions.isLoading || query.isLoading,
    isError: directions.isError || query.isError,
  };
}
