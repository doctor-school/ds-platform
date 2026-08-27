"use client";

import { useCustom, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { ComboboxOption } from "@ds/design-system/blocks";
import {
  ADMIN_LIST_PAGE_SIZE_MAX,
  DIRECTION_ADJACENCY_KINDS,
  type DirectionAdjacencyKind,
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

/**
 * The «Вид связи» vocabulary (017-design §9.3, EARS-18) as `Combobox` options.
 *
 * The value set is the SSOT enum `DIRECTION_ADJACENCY_KINDS` — mapping over the
 * constant rather than re-listing three strings is what keeps the UI closed when
 * the enum moves. Only the RU label and the per-option explanation live here:
 * picking an adjacency kind is a taxonomy decision, so each option states what it
 * means at the point of choice instead of leaving the operator to infer it from a
 * slug.
 */
export function useDirectionAdjacencyKindOptions(): ComboboxOption[] {
  const t = useTranslations();
  return DIRECTION_ADJACENCY_KINDS.map((kind: DirectionAdjacencyKind) => ({
    value: kind,
    label: t(`directionAdjacency.kinds.${kind}.label`),
    description: t(`directionAdjacency.kinds.${kind}.description`),
  }));
}

/** The RU label alone — the list column and the record heading render this. */
export function useDirectionAdjacencyKindLabel(): (
  kind: DirectionAdjacencyKind,
) => string {
  const t = useTranslations();
  return (kind) => t(`directionAdjacency.kinds.${kind}.label`);
}
