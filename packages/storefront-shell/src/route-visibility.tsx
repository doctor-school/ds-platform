"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { isHiddenPath } from "./config";

/**
 * 008 EARS-12 — the ONE client boundary that hides the chrome on a host's own
 * chrome-carrying routes (the auth surfaces, the webinar room).
 *
 * It exists as a separate tiny component on purpose. The header and the footer
 * are server components; wrapping them in this only when the host config
 * actually declares `hiddenOnPaths` keeps a host that scopes its chrome by
 * route group (a `(storefront)` segment, a `@chrome` parallel-route slot)
 * completely free of a client-navigation hook — no boundary is added for a
 * capability that host does not use.
 */
export function VisibleOffPaths({
  patterns,
  children,
}: {
  patterns: readonly string[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  return isHiddenPath(pathname, patterns) ? null : <>{children}</>;
}
