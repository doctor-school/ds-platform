"use server";

import type { ReactNode } from "react";
import { headers } from "next/headers";
import { SpecialtyCodeSchema } from "@ds/schemas";

import { SpecialtyFeedAdjacentList } from "@/components/specialty-feed-adjacent-block";
import { fetchSpecialtyFeedAdjacent } from "@/lib/specialty-feed";

/**
 * 018 EARS-8 (#1503) — «Повторить» in the failed adjacent-areas block re-runs
 * only that block's read and answers that block's body alone, as the nearest-
 * events block's retry does (019 EARS-9). The code crosses the wire from the
 * browser, so it is parsed before any read.
 */
export async function retryDoctorAdjacentBlock(
  specialtyCode: string,
): Promise<ReactNode> {
  const code = SpecialtyCodeSchema.parse(specialtyCode);
  const requestHeaders = await headers();
  return SpecialtyFeedAdjacentList({
    specialtyCode: code,
    read: await fetchSpecialtyFeedAdjacent(
      code,
      requestHeaders.get("x-forwarded-for") ?? "",
    ),
    retry: retryDoctorAdjacentBlock,
  });
}
