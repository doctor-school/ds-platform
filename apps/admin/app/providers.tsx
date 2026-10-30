"use client";

import type { ReactNode } from "react";
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/nextjs-router";
import { useTranslations } from "next-intl";
import { dataProvider } from "@/providers/data-provider";
import { authProvider } from "@/providers/auth-provider";
import { accessControlProvider } from "@/providers/access-control-provider";
import { ADMIN_QUERY_CLIENT_CONFIG } from "@/lib/admin-query-retry";

/**
 * The Refine CSR shell (ADR-0004 §4 caveat — Refine manages its own QueryClient
 * behind this `"use client"` boundary; the admin app is effectively CSR with a
 * thin SSR layout; its retry policy is `lib/admin-query-retry.ts`). Wires the custom data/auth/access providers (007 EARS-8/11)
 * and the taxonomy/event resources whose routes back the admin surface. The
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
        // 048 EARS-7 (#3512) — the Academy's own materials, on the taxonomy
        // provider path (JSON writes, If-Match on every non-create).
        {
          name: "materials",
          list: "/materials",
          create: "/materials/create",
          edit: "/materials/:id",
          meta: { label: t("app.nav.materials") },
        },
        // 012 content taxonomy: projects (#1283), experts (#1284), directions
        // (#1285) and organisations (012 #1286 partners, renamed by 032 #3492)
        // on the same shared list shell and provider — one composition.
        {
          name: "projects",
          list: "/projects",
          create: "/projects/create",
          edit: "/projects/:id",
          meta: { label: t("app.nav.projects") },
        },
        {
          name: "experts",
          list: "/experts",
          create: "/experts/create",
          edit: "/experts/:id",
          meta: { label: t("app.nav.experts") },
        },
        {
          name: "organisations",
          list: "/organisations",
          create: "/organisations/create",
          edit: "/organisations/:id",
          meta: { label: t("app.nav.organisations") },
        },
        // 032 EARS-3 — the role book; read and written through `custom`
        // (organisationRolesUrl), registered so the chrome knows the section.
        {
          name: "organisation-roles",
          list: "/organisation-roles",
          create: "/organisation-roles/create",
          edit: "/organisation-roles/:id",
          meta: { label: t("app.nav.organisationRoles") },
        },
        {
          name: "directions",
          list: "/directions",
          create: "/directions/create",
          edit: "/directions/:id",
          meta: { label: t("app.nav.directions") },
        },
        // 012 EARS-25 (#2509) — the event-kind dictionary, mirroring directions.
        {
          name: "event-kinds",
          list: "/event-kinds",
          create: "/event-kinds/create",
          edit: "/event-kinds/:id",
          meta: { label: t("app.nav.eventKinds") },
        },
      ]}
      options={{
        syncWithLocation: true,
        warnWhenUnsavedChanges: false,
        disableTelemetry: true,
        // #2998: a 401/403 is never retried — the sign-in redirect is immediate.
        reactQuery: { clientConfig: ADMIN_QUERY_CLIENT_CONFIG },
      }}
    >
      {children}
    </Refine>
  );
}
