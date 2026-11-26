import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { documentVersionTag, loadDocument } from "@ds/legal-content";
import { AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG } from "@ds/schemas";

/**
 * 033 EARS-3, EARS-4, EARS-6 — the page's server mount: the guest decision,
 * the account the form is sent under, the consent version tag and the
 * specialty book handed to the page. The page itself is asserted in
 * `ui/apply-page.test.tsx`.
 */

const { resolveServerAuth } = vi.hoisted(() => ({
  resolveServerAuth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth,
}));

import { ApplyPage, type ApplyPageProps } from "../ui";
import { ApplyRoute, type ApplyHostConfig } from "./apply-route";

const CONFIG: ApplyHostConfig = {
  authFlow: {
    routes: {
      login: "/login",
      register: "/register",
      verify: "/verify",
      reset: "/reset",
      account: "/account",
      eventPathTemplate: "/webinars/:slug",
      apply: "/apply",
    },
  },
  homeHref: "/",
  policyHref: "/documents",
};

const BOOK = {
  entries: [
    {
      id: "0193b6c2-6c1a-7000-8000-000000000001",
      code: "travmatologiya-i-ortopediya",
      name: "Травматология и ортопедия",
      isOther: false,
    },
    {
      id: "0193b6c2-6c1a-7000-8000-000000000002",
      code: "drugoe",
      name: "Другое",
      isOther: true,
    },
  ],
  total: 2,
};

const consentDocument = loadDocument(AUTHOR_APPLICATION_CONSENT_DOCUMENT_SLUG);
const CONSENT = consentDocument ? documentVersionTag(consentDocument) : "";

function page(el: unknown): ApplyPageProps {
  expect(isValidElement(el)).toBe(true);
  const element = el as ReactElement<ApplyPageProps>;
  expect(element.type).toBe(ApplyPage);
  return element.props;
}

const fetchImpl = vi.fn<typeof fetch>();

beforeEach(() => {
  resolveServerAuth.mockReset();
  fetchImpl.mockReset();
  fetchImpl.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/public/specialties"))
      return new Response(JSON.stringify(BOOK), { status: 200 });
    if (url.endsWith("/v1/me/profile"))
      return new Response(
        JSON.stringify({
          email: "anna@example.test",
          emailVerified: true,
          phone: null,
          phoneVerified: null,
          displayName: "Анна Крылова",
          suggestedPhone: null,
        }),
        { status: 200 },
      );
    return new Response("{}", { status: 404 });
  });
});

describe("ApplyRoute", () => {
  it("033 EARS-3: a guest gets the gate whose one action carries /apply as the return target", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });
    const props = page(await ApplyRoute({ config: CONFIG, fetchImpl }));
    expect(props.viewer).toBeNull();
    expect(props.gate).toEqual({ signInHref: "/login?returnTo=%2Fapply" });
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/me\/profile$/),
      expect.anything(),
    );
  });

  it("033 EARS-4, EARS-6: an account gets its name and email, the current consent tag and the book without «Другое»", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "u", roles: [], mfa: false },
    });
    const props = page(await ApplyRoute({ config: CONFIG, fetchImpl }));
    expect(props.viewer).toEqual({
      displayName: "Анна Крылова",
      email: "anna@example.test",
    });
    expect(CONSENT).toMatch(/^\d{4}-\d{2}-\d{2}\.sha256-[0-9a-f]{64}$/);
    expect(props.form.consentVersion).toBe(CONSENT);
    expect(props.form.specialties).toEqual([
      {
        code: "travmatologiya-i-ortopediya",
        name: "Травматология и ортопедия",
      },
    ]);
    expect(props.form.policyHref).toBe("/documents");
    expect(props.homeHref).toBe("/");
  });

  it("033 EARS-3: a session whose profile read fails is a guest — the gate, never a form without an account", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "u", roles: [], mfa: false },
    });
    fetchImpl.mockImplementation(async (input) =>
      String(input).endsWith("/v1/me/profile")
        ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify(BOOK), { status: 200 }),
    );
    const props = page(await ApplyRoute({ config: CONFIG, fetchImpl }));
    expect(props.viewer).toBeNull();
  });

  it("033 EARS-4: a failed book read leaves the form with «Другое» only", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "u", roles: [], mfa: false },
    });
    fetchImpl.mockImplementation(async (input) =>
      String(input).endsWith("/v1/public/specialties")
        ? new Response("{}", { status: 503 })
        : new Response(
            JSON.stringify({
              email: "anna@example.test",
              displayName: null,
            }),
            { status: 200 },
          ),
    );
    const props = page(await ApplyRoute({ config: CONFIG, fetchImpl }));
    expect(props.form.specialties).toEqual([]);
    expect(props.viewer).toEqual({
      displayName: null,
      email: "anna@example.test",
    });
  });
});
