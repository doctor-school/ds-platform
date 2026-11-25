import { headers } from "next/headers";

import type { AuthFlowHostConfig } from "@ds/auth-flow/host-config";
import { BotProtectionDisclosure } from "@ds/auth-flow/bot-protection";
import { withRuntimeBotProtection } from "@ds/auth-flow/bot-protection/server";
import {
  forwardedHeaders,
  forwardedSessionFrom,
  resolveServerAuth,
  serverApiBase,
  withReturnContext,
} from "@ds/auth-flow/server";
import { documentVersionTag, loadDocument } from "@ds/legal-content";
import {
  AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG,
  SpecialtyBookSchema,
} from "@ds/schemas";

import { ApplyPage, type ApplyViewer, type AuthorSpecialty } from "../ui";

/** The host half of «Подать заявку»: its auth flow and its two links. */
export interface ApplyHostConfig {
  /** The host's auth flow; `routes.apply` is where the page is mounted. */
  authFlow: Pick<AuthFlowHostConfig, "routes"> &
    Partial<Pick<AuthFlowHostConfig, "botProtection" | "copy">>;
  /** The host home — the breadcrumb's first step. */
  homeHref: string;
  /** The personal-data policy and consents page (EARS-6). */
  policyHref: string;
}

/**
 * 033 EARS-1, EARS-3, EARS-4, EARS-6 — the server mount of «Подать заявку».
 * A guest is decided on the SERVER and gets the account gate, whose two doors
 * carry the page as the return target (`routes.apply`, admitted by
 * `@ds/auth-flow`'s return codec), so the sign-in or registration lands back on
 * the open form. A signed-in account gets the form under its own name and
 * email (`GET /v1/me/profile`, read on its behalf), stamped with the current
 * consent version tag — the same `documentVersionTag` the api checks — and
 * the Минздрав specialty book.
 *
 * The host route file renders this with its host config and nothing else.
 * `fetchImpl` is injected by tests only.
 */
export async function ApplyRoute({
  config,
  fetchImpl = fetch,
}: {
  config: ApplyHostConfig;
  fetchImpl?: typeof fetch;
}) {
  const { authFlow, homeHref, policyHref } = config;
  const path = authFlow.routes.apply;
  if (!path) throw new Error("ApplyRoute: the host declares no routes.apply");

  const gate = {
    signInHref: withReturnContext(authFlow, authFlow.routes.login, path),
    registerHref: withReturnContext(authFlow, authFlow.routes.register, path),
  };
  const requestHeaders = await headers();
  const session = await resolveServerAuth(requestHeaders, fetchImpl);
  const viewer =
    session.status === "guest"
      ? null
      : await readViewer(requestHeaders, fetchImpl);

  const consent = loadDocument(AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG);
  // The consent text ships with the image; without it no application can be
  // stored (the api answers 503), so the page fails loudly instead.
  if (!consent)
    throw new Error(
      `ApplyRoute: legal document ${AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG} is missing`,
    );
  const runtime = withRuntimeBotProtection(authFlow as AuthFlowHostConfig);

  return (
    <ApplyPage
      viewer={viewer}
      homeHref={homeHref}
      gate={gate}
      form={{
        consentVersion: documentVersionTag(consent),
        policyHref,
        specialties: viewer ? await readSpecialties(fetchImpl) : [],
        botProtectionSiteKey: runtime.botProtection?.siteKey,
      }}
      disclosure={<BotProtectionDisclosure config={runtime} />}
    />
  );
}

/**
 * The account the application is sent under; `null` for a 401 or any failed
 * read, which the page treats as a guest — never a form without an account.
 */
async function readViewer(
  requestHeaders: Headers,
  fetchImpl: typeof fetch,
): Promise<ApplyViewer | null> {
  try {
    const res = await fetchImpl(`${serverApiBase()}/v1/me/profile`, {
      headers: forwardedHeaders(forwardedSessionFrom(requestHeaders)),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const profile = (await res.json()) as {
      email?: unknown;
      displayName?: unknown;
    };
    if (typeof profile.email !== "string") return null;
    return {
      email: profile.email,
      displayName:
        typeof profile.displayName === "string" && profile.displayName.trim()
          ? profile.displayName
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * EARS-4 — the whole `specialties_minzdrav` book by name; the book's own
 * «Другое» row is left out because the form draws «Другое» with its text field
 * itself. A failed read leaves «Другое» alone, so the form still sends.
 */
async function readSpecialties(
  fetchImpl: typeof fetch,
): Promise<AuthorSpecialty[]> {
  try {
    const res = await fetchImpl(`${serverApiBase()}/v1/public/specialties`, {
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return [];
    const parsed = SpecialtyBookSchema.safeParse(await res.json());
    if (!parsed.success) return [];
    return parsed.data.entries
      .filter((e) => !e.isOther)
      .map((e) => ({ code: e.code, name: e.name }));
  } catch {
    return [];
  }
}
