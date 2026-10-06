"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  academyPublicUrl,
  type AcademyPublicSection,
} from "@/lib/academy-origin";

/**
 * Carries the server-resolved Academy public origin (`lib/academy-origin.ts`,
 * #2619) into the CSR Refine tree, so the project / partner / expert forms
 * build «Публичная ссылка» from configuration instead of a hardcoded host.
 */
const AcademyOriginContext = createContext<string | null>(null);

export function AcademyOriginProvider({
  origin,
  children,
}: {
  origin: string;
  children: ReactNode;
}) {
  return (
    <AcademyOriginContext.Provider value={origin}>
      {children}
    </AcademyOriginContext.Provider>
  );
}

/** The public Academy URL of a record, or `null` while it has no slug. */
export function useAcademyPublicUrl(
  section: AcademyPublicSection,
  slug: string | null | undefined,
): string | null {
  const origin = useContext(AcademyOriginContext);
  if (origin === null) {
    throw new Error(
      "useAcademyPublicUrl needs <AcademyOriginProvider> (mounted by the root layout)",
    );
  }
  return slug ? academyPublicUrl(origin, section, slug) : null;
}
