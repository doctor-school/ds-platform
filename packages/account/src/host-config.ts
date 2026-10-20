import type { AuthFlowHostConfig } from "@ds/auth-flow/host-config";

/**
 * What a storefront states about itself so the ONE account cabinet can serve it
 * (wave-4 entry gate D1, ADR-0013 A1). DATA only — no callback, resolver or
 * predicate (plan §2; the closed adapter list is empty). Each host declares its
 * value as a second export of its `lib/auth-flow.host-config.ts`, checked with
 * `satisfies`.
 */
export type AccountHostConfig = {
  /**
   * The host's existing `@ds/auth-flow` config. The cabinet builds its bound
   * client from `api` (`createAuthClient`, as each host's `lib/auth-flow-client.ts`
   * does), reads the bounce and handoff targets from `routes.login`,
   * `routes.account` and `routes.reset` (gate rows 1, 5, 12), and maps a failed
   * save through the host's resolved auth error copy (row 10).
   */
  authFlow: AuthFlowHostConfig;
  /** The «Мои события» target — the host's `events-storefront` `routes.accountEvents` (row 13). */
  eventsHref: string;
  /**
   * The «Мои заявки на Конгресс» section (046 EARS-4, row 14): its path on a
   * host that mounts the section, `null` on a host that does not — the cabinet
   * then makes no section read and renders no row.
   */
  congress: { path: string } | null;
};
