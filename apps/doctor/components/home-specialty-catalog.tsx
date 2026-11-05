"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  type SpecialtyChoice,
  type SpecialtyRef,
  specialtyFeedPath,
} from "@ds/schemas";

import { SpecialtyCatalog } from "@/components/specialty-catalog";
import type { SpecialtyActor } from "@/lib/specialty-choice";

/**
 * 017 EARS-6 / EARS-7 on the home (018 entry, #3674) — the home's specialty
 * catalog, whose recorded choice opens that specialty's feed, `/feed/<code>`.
 *
 * The SAME `SpecialtyCatalog` the feed's «сменить специальность» mounts; only
 * the follow-up differs. Navigation runs on the RECORDED specialty the command
 * returned, never on the entry clicked, so a rejected save keeps the visitor on
 * the open catalog with its error (the catalog's own failure branch).
 */
export function HomeSpecialtyCatalog({
  actor,
  initialChoice,
}: {
  actor: SpecialtyActor;
  initialChoice: SpecialtyChoice | null;
}) {
  const router = useRouter();
  const onChosen = useCallback(
    (chosen: SpecialtyRef) => {
      router.push(specialtyFeedPath(chosen.code));
    },
    [router],
  );

  return (
    <SpecialtyCatalog
      actor={actor}
      initialChoice={initialChoice}
      onChosen={onChosen}
    />
  );
}
