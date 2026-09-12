import NextLink from "next/link";
import { Button } from "@ds/design-system/button";
import { Link } from "@ds/design-system/link";
import type { ShellAuth } from "@/lib/shell-auth";

/**
 * 017 EARS-1 — the doctor storefront's auth affordances, the host filler of the
 * shared chrome's `authCluster` slot (`@ds/storefront-shell`, #2180).
 *
 * The slot is a host decision on purpose: each storefront still reads its own
 * session (#2027 is what gives that read a shared home), and this host resolves
 * it on the SERVER, in the `(storefront)` layout, from the request headers. So
 * this component is presentational and pure — the branch arrives as the already
 * resolved {@link ShellAuth}, which is what makes "exactly one cluster, never a
 * transitional state" a property of the first byte of HTML rather than of a
 * settled client effect, and directly assertable for BOTH branches in a unit
 * test the backend-free Playwright tier cannot reach.
 *
 * Both CTAs are the DS `on-primary` variant — the white chip designed for the
 * navy header band.
 */
export function StorefrontAuthCluster({ auth }: { auth: ShellAuth }) {
  if (auth.status === "guest") {
    return (
      <div
        data-testid="shell-action-cluster"
        data-cluster="guest"
        className="flex items-center gap-3"
      >
        <Link asChild tone="on-primary" className="whitespace-nowrap">
          <NextLink href="/login">Войти</NextLink>
        </Link>
        <Button asChild variant="on-primary" className="whitespace-nowrap">
          <NextLink href="/register">Регистрация</NextLink>
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="shell-action-cluster"
      data-cluster="doctor"
      className="flex items-center gap-3"
    >
      {/*
        The canvas signed-in cluster is «плашка очков» + «Личный кабинет». The
        points plate is NOT rendered and NOT stubbed: no shipped contract in
        `packages/schemas` carries a points value, so drawing it today would mean
        inventing a contract or painting a placeholder number at a doctor — both
        forbidden (AGENTS.md §6). The plate lands with its read contract, Issue
        #1559; the slot is absent rather than faked.
      */}
      <Button asChild variant="on-primary" className="whitespace-nowrap">
        <NextLink href="/account">Личный кабинет</NextLink>
      </Button>
    </div>
  );
}
