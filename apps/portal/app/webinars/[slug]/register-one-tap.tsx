"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@ds/design-system/button";
import { FormError } from "@ds/design-system/form";

import { registerForEvent, RegistrationError } from "@/lib/registration-client";

/**
 * 005 EARS-1 — the logged-in one-tap register affordance on the event page.
 *
 * For a doctor who already has a 003 session but is NOT yet registered, the
 * «Участвовать» CTA is a ONE-ACTION command, not a trip through the auth flow
 * (that guest path is the plain `/register` link — `buildRegistrationHref`). This
 * client button POSTs the real `RegisterForEvent` (`lib/registration-client`,
 * same-origin `credentials: "include"`) and, on the 200, calls `router.refresh()`
 * so the server component re-reads the per-user `EventRegistrationState` (EARS-4)
 * and swaps to the registered confirmation — no second step, no confirmation
 * round-trip (design §3.1). A repeat is a server-side idempotent no-op (EARS-3).
 *
 * The guest path never reaches this component: the event page renders the
 * `/register` handoff link when no session rode the request (registration state
 * `null`); this button appears only for an authenticated, unregistered caller.
 * All copy resolves through the message catalog (EARS-12) — passed in as props so
 * the server component owns the `next-intl` lookup.
 */
export function RegisterOneTap({
  slug,
  label,
  errorLabel,
}: {
  readonly slug: string;
  readonly label: string;
  readonly errorLabel: string;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRegister() {
    setError(null);
    setBusy(true);
    try {
      await registerForEvent(slug);
      // Re-read the per-user state server-side so the page swaps to the registered
      // confirmation from the REAL read model (not an optimistic client guess).
      startRefresh(() => router.refresh());
    } catch (err) {
      // A gating refusal (409), an expired session (401), or a transient error:
      // surface a single retryable message and let the doctor try again. Firing
      // again after a real registration is an idempotent no-op (EARS-3).
      void (err instanceof RegistrationError);
      setError(errorLabel);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="lg"
        onClick={onRegister}
        loading={busy || isRefreshing}
        data-testid="event-register-one-tap"
      >
        {label}
      </Button>
      {/* The error tone/markup is owned by the DS `FormError` primitive (ADR-0013
          §7) — it renders nothing when there is no message. */}
      <FormError>{error}</FormError>
    </div>
  );
}
