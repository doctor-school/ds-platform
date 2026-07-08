"use client";

import type { ReactNode } from "react";
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import { useTranslations } from "next-intl";
import { dataProvider } from "@/providers/data-provider";
import { authProvider } from "@/providers/auth-provider";
import { accessControlProvider } from "@/providers/access-control-provider";

/**
 * The Refine CSR shell (ADR-0004 §4 caveat — Refine manages its own QueryClient
 * behind this `"use client"` boundary; the admin app is effectively CSR with a
 * thin SSR layout). Wires the custom data/auth/access providers (007 EARS-8/11)
 * and the single `events` resource whose routes back the design §8 surface. The
 * i18n copy is next-intl (`useTranslations` in each page), so Refine's own
 * `i18nProvider` is not needed — every user-facing string flows through the RU
 * catalog and the `no-hardcoded-display-string` gate (EARS-10).
 */
export function Providers({ children }: { children: ReactNode }) {
  const t = useTranslations();
  return (
    <Refine
      dataProvider={dataProvider}
      authProvider={authProvider}
      accessControlProvider={accessControlProvider}
      routerProvider={routerProvider}
      resources={[
        {
          name: "events",
          list: "/events",
          create: "/events/create",
          edit: "/events/:id",
          meta: { label: t("app.nav.events") },
        },
      ]}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
        disableTelemetry: true,
      }}
    >
      {children}
    </Refine>
  );
}
