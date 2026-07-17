"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@ds/design-system/button";
import { FormError } from "@ds/design-system/form";

import { registerForEvent } from "@/lib/registration-client";

import { registerForEventAction } from "./register-action";

/**
 * 005 EARS-1 — the logged-in one-tap register affordance on the event page,
 * PROGRESSIVELY ENHANCED (#1111).
 *
 * For a doctor who already has a 003 session but is NOT yet registered, the
 * «Участвовать» CTA is a ONE-ACTION command, not a trip through the auth flow
 * (that guest path is the plain `/register` link — `buildRegistrationHref`).
 *
 * The CTA is a REAL `<form>` whose action is a server action
 * (`registerForEventAction`), so it registers with ZERO client JS: on a weak
 * network where the bundle is slow or fails to load, the native form POST still
 * fires the command server-side and lands the doctor back on the event page —
 * never a dead button (the #1111 defect). Once hydrated, the SAME control keeps
 * today's one-tap path: `onSubmit` intercepts the submit, POSTs the real
 * `RegisterForEvent` client-side (`lib/registration-client`, same-origin
 * `credentials: "include"`), and calls `router.refresh()` so the server component
 * re-reads the per-user `EventRegistrationState` (EARS-4) and swaps to the
 * registered confirmation IN PLACE — no navigation, no confirmation round-trip
 * (design §3.1). Either arm is a server-side idempotent no-op on a repeat (EARS-3).
 *
 * The guest path never reaches this component: the event page renders the
 * `/register` handoff link when no session rode the request (registration state
 * `null`); this control appears only for an authenticated, unregistered caller.
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    // JS is present → intercept the native/server-action submit and keep today's
    // ONE-TAP no-navigation path. Pre-hydration this handler never runs, and the
    // `<form action>` server action registers the doctor without any client JS.
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await registerForEvent(slug);
      // Re-read the per-user state server-side so the page swaps to the registered
      // confirmation from the REAL read model (not an optimistic client guess).
      startRefresh(() => router.refresh());
    } catch {
      // A gating refusal (409), an expired session (401), or a transient error:
      // surface a single retryable message and let the doctor try again. Firing
      // again after a real registration is an idempotent no-op (EARS-3).
      setError(errorLabel);
      setBusy(false);
    }
  }

  return (
    <form
      action={registerForEventAction}
      onSubmit={onSubmit}
      className="flex flex-col items-start gap-2"
    >
      {/* No-JS payload: the server action reads the slug from the submitted form. */}
      <input type="hidden" name="slug" value={slug} />
      <Button
        type="submit"
        size="lg"
        loading={busy || isRefreshing}
        data-testid="event-register-one-tap"
      >
        {label}
      </Button>
      {/* The error tone/markup is owned by the DS `FormError` primitive (ADR-0013
          §7) — it renders nothing when there is no message. */}
      <FormError>{error}</FormError>
    </form>
  );
}
