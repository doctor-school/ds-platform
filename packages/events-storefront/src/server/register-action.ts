"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseReturnTarget } from "@ds/schemas";

import { forwardedHeaders, forwardedSessionFrom } from "./registration-state";

/**
 * #1111 (005 EARS-1) — the SERVER-side arm of the logged-in one-tap register CTA,
 * the progressive-enhancement fallback the `<form>` posts to when JavaScript has
 * not (yet) hydrated — a slow or failed bundle on a weak network no longer leaves
 * the «Участвовать» button dead. It performs the SAME `RegisterForEvent` command
 * as the browser client, but server-to-server, forwarding the incoming request's
 * session cookie AND its fingerprint surface so the api resolves + re-derives the
 * `__Host-` session exactly as the authenticated read does (the BFF session is
 * fingerprint-bound, ADR-0001 §6).
 *
 * Idempotent server-side (EARS-3): a repeat POST is a no-op returning the existing
 * registration, so a double submit on a laggy connection never duplicates. Whatever
 * the outcome (registered / already-registered / lapsed session), the doctor is
 * redirected BACK to the event page they submitted from, where the server re-reads
 * the per-user `EventRegistrationState` (EARS-4) and renders the truthful
 * affordance — the «вы записаны» confirmation, or the register/guest CTA again if
 * the session lapsed — never an optimistic client guess on the no-JS path.
 *
 * WHICH event page that is comes from the control's own hidden `returnTo` field,
 * run through the shared `@ds/schemas` guard: `/webinars/<slug>` on the academy,
 * `/events/<slug>` on the doctor storefront (020 EARS-1). One action serves both
 * hosts because the guard — not this module and not a host-local rule — decides
 * what a safe return path looks like; an absent or unsafe value falls back to the
 * calling host's own root rather than becoming an open redirect.
 *
 * The upstream is the same env-driven `API_PROXY_TARGET` each host's rewrite and
 * SSR reader use — never a hardcoded host, so dev and prod differ by config only.
 */
const API_BASE = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

export async function registerForEventAction(
  formData: FormData,
): Promise<void> {
  // The slug rides the submitted form (the hidden field the CTA renders). It only
  // ever addresses an event the caller can already see + register for one-tap, and
  // the api authorizes by session, so a tampered slug grants no new capability.
  const slug = String(formData.get("slug") ?? "");
  // The host's own event path rides the same form, so this one action lands the
  // doctor back on the storefront they submitted from.
  const landing = parseReturnTarget(formData.get("returnTo"))?.returnTo ?? "/";
  // Defensive: a submit with no slug can only be a malformed/forged POST — send it
  // to the front door rather than issuing a `/v1/events//…` request.
  if (!slug) redirect("/");

  const h = await headers();
  await fetch(`${API_BASE}/v1/events/${encodeURIComponent(slug)}/registration`, {
    method: "POST",
    // The session cookie must ride the server-to-server hop alongside the whole
    // fingerprint surface — user-agent, accept-language AND the forwarded client
    // address — or the api re-derives a different fingerprint and 401s a valid
    // session (ADR-0001 §6 / 003 design §3, #2054).
    headers: forwardedHeaders(forwardedSessionFrom(h)),
    // Per-user, authenticated — never shared-cached.
    cache: "no-store",
  });

  // Back to the event page for a fresh authenticated re-read of the state (EARS-4).
  redirect(landing);
}
