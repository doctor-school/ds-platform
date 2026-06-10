"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, ShieldCheck } from "lucide-react";

import type { SessionClaims } from "@ds/schemas";

import { authClient } from "@/lib/auth-client";

import { Button } from "@ds/design-system/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ds/design-system/card";

/*
 * Session-aware landing (#131, EARS-8 read side + EARS-9 + EARS-10). Reads the
 * authenticated principal through the same-origin `GET /v1/auth/session`, which
 * resolves the `__Host-ds_session` cookie server-side — the access/refresh tokens
 * never reach this client, only `{ sub, roles[], mfa }`.
 *
 * EARS-9 silent-refresh: a 401 from session means the cookie still resolves to a
 * session whose server-side access token may have expired. We attempt ONE silent
 * `POST /v1/auth/refresh` (server-side rotation, no token returned) and retry the
 * read once; only if that still 401s do we redirect to `/login`. This is the
 * client mirror of the BFF's rotate-on-expiry behavior.
 *
 * Logout (EARS-10) posts `/v1/auth/logout`, which revokes the server-side session
 * and clears the cookie, then we route back to `/login`.
 */

type State =
  | { kind: "loading" }
  | { kind: "authenticated"; claims: SessionClaims };

export default function AccountPage() {
  const router = useRouter();
  const t = useTranslations("account");
  const [state, setState] = useState<State>({ kind: "loading" });

  const loadSession = useCallback(async () => {
    let claims = await authClient.session();
    if (!claims) {
      // EARS-9: one silent refresh, then one retry, before giving up.
      try {
        await authClient.refresh();
        claims = await authClient.session();
      } catch {
        // refresh 401 (no/expired/reused session) — fall through to redirect.
      }
    }
    if (claims) {
      setState({ kind: "authenticated", claims });
    } else {
      router.replace("/login");
    }
  }, [router]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function onLogout() {
    try {
      await authClient.logout();
    } finally {
      // Whether or not the revoke round-trip succeeded, the user intends to leave.
      router.replace("/login");
    }
  }

  if (state.kind === "loading") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <p className="text-sm text-muted-foreground" role="status">
          {t("loading")}
        </p>
      </main>
    );
  }

  const { claims } = state;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-primary" aria-hidden />
            <CardTitle>{t("title")}</CardTitle>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("subject")}</dt>
              <dd className="font-mono break-all" data-testid="session-sub">
                {claims.sub}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("roles")}</dt>
              <dd data-testid="session-roles">
                {claims.roles.length
                  ? claims.roles.join(", ")
                  : t("rolesEmpty")}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("mfa")}</dt>
              <dd>{claims.mfa ? t("mfaEnabled") : t("mfaDisabled")}</dd>
            </div>
          </dl>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onLogout}
            data-testid="logout"
          >
            <LogOut aria-hidden /> {t("signOut")}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
