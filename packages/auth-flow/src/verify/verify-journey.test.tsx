// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The confirmation JOURNEY across the server/client boundary: the `/verify`
 * mount is rendered as the host serves it, the visitor types the code, and the
 * router is where they end up (021 EARS-10, amendment 2026-09-29).
 *
 * The mount-tier decision is pinned in `verify-route.test.tsx` and the step's
 * client wiring in `verify-step.test.tsx`; this tier owns what neither can see
 * alone — that the эфир read is asked again once the code is accepted, since
 * the letter can arrive long after `/verify` rendered.
 *
 * Mocked seams: the network (`fetch` — the public event read answers per test),
 * the principal read (`resolveServerAuth`), Next's router / redirect / headers,
 * the BFF factory, the 005 EARS-2 transport entry and the challenge widget. The
 * arrival decision, the guard, the landing rule and the completion rule are the
 * real shared ones.
 */
const h = vi.hoisted(() => ({
  verify: vi.fn(),
  login: vi.fn(),
  registerForEvent: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  /** What `GET /v1/public/events/:slug` answers right now. */
  eventRead: "found" as "found" | "gone" | "down" | "offline",
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: h.refresh }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../server/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/session")>()),
  resolveServerAuth: async () => ({ status: "guest" }),
}));
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    verify: (...args: unknown[]) => h.verify(...args),
    login: (...args: unknown[]) => h.login(...args),
    resendVerification: vi.fn(),
  }),
}));
vi.mock("@ds/events-storefront/client", () => ({
  registerForEvent: (...args: unknown[]) => h.registerForEvent(...args),
  RegistrationError: class extends Error {},
}));
vi.mock("@ds/design-system/blocks", async () => ({
  ...(await vi.importActual<typeof import("@ds/design-system/blocks")>(
    "@ds/design-system/blocks",
  )),
  BotProtectionField: () => <div data-testid="bot-protection-field" />,
}));

import {
  clearPendingRegistration,
  setPendingRegistration,
} from "@ds/design-system/blocks";

import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { VerifyRoute } from "./verify-route";

const EMAIL = "doc@example.com";
const SLUG = "prp-pri-gonartroze";

const EVENT_PAGE = {
  id: "00000000-0000-4000-8000-0000000005f7",
  slug: SLUG,
  title: "PRP при гонартрозе",
  school: "Школа ортобиологии",
  startsAt: "2026-08-27T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор показаний.",
  speakers: [],
  specialties: ["Травматология"],
  partners: [],
  links: { speakerPages: [] },
  nmo: false,
  pulCost: 0,
  // An ended эфир still answers: its page states that itself (decision Б).
  state: "ended",
  format: "online",
  seatsLeft: null,
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
    durationSec: null,
  },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  h.verify.mockReset().mockResolvedValue({ status: "verified" });
  h.login.mockReset().mockResolvedValue({});
  h.registerForEvent.mockReset().mockResolvedValue(undefined);
  h.push.mockReset();
  h.replace.mockReset();
  h.refresh.mockReset();
  h.eventRead = "found";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes(`/v1/public/events/${SLUG}`)) {
        // Every other upstream read (the remembered specialty) knows nothing.
        return json({}, 404);
      }
      switch (h.eventRead) {
        case "found":
          return json(EVENT_PAGE, 200);
        case "gone":
          return json({ message: "event not found" }, 404);
        case "down":
          return json({ message: "upstream unavailable" }, 503);
        case "offline":
          throw new TypeError("fetch failed");
      }
    }),
  );
  clearPendingRegistration();
  setPendingRegistration({
    identifier: EMAIL,
    registration: { password: "Sup3rSecret!", consent: [] },
    form: { email: EMAIL, password: "Sup3rSecret!", promoCode: "", consents: {} },
  });
  document.elementFromPoint = () => document.body;
});

afterEach(() => {
  cleanup();
  clearPendingRegistration();
  vi.unstubAllGlobals();
});

async function renderVerify(config: AuthFlowHostConfig) {
  render(
    await VerifyRoute({
      config,
      searchParams: Promise.resolve({
        email: EMAIL,
        returnTo: `/webinars/${SLUG}`,
      }),
    }),
  );
}

async function enterCode(config: AuthFlowHostConfig) {
  const user = userEvent.setup({ delay: null });
  await user.type(
    await screen.findByLabelText(resolveAuthFlowCopy(config).verify.codeLabel),
    "482913",
  );
}

const HOSTS = [
  ["Витрина", DOCTOR_FIXTURE, `/events/${SLUG}`],
  ["Академия", ACADEMY_FIXTURE, `/webinars/${SLUG}`],
] as const;

describe("021 EARS-10 (#2455, amendment 2026-09-29): the landing is decided when the code is accepted", () => {
  it.each(HOSTS)(
    "021 EARS-10: on %s an эфир that stops existing after /verify rendered is no target — the confirmed doctor lands on the default landing",
    async (_host, config) => {
      await renderVerify(config);
      // The letter arrives later; meanwhile the эфир is retired.
      h.eventRead = "gone";

      await enterCode(config);

      await waitFor(() =>
        expect(h.replace).toHaveBeenCalledWith(config.landing.afterLogin),
      );
      expect(h.registerForEvent).not.toHaveBeenCalled();
    },
  );

  it.each(HOSTS)(
    "021 EARS-10: on %s an эфир that still answers (ended) when the code is accepted is where the confirmed doctor lands",
    async (_host, config, page) => {
      await renderVerify(config);

      await enterCode(config);

      await waitFor(() => expect(h.replace).toHaveBeenCalledWith(page));
      expect(h.registerForEvent).toHaveBeenCalledWith(SLUG);
    },
  );

  it.each(
    HOSTS.flatMap(([host, config, page]) =>
      (["down", "offline"] as const).map(
        (read) => [host, read, config, page] as const,
      ),
    ),
  )(
    "021 EARS-10: on %s an event read that fails (%s) is not «no longer exists» — the эфир page stays the landing",
    async (_host, read, config, page) => {
      await renderVerify(config);
      h.eventRead = read;

      await enterCode(config);

      await waitFor(() => expect(h.replace).toHaveBeenCalledWith(page));
    },
  );

  it.each(HOSTS)(
    "021 EARS-10: on %s an event read that fails while /verify renders keeps the эфир as the target",
    async (_host, config, page) => {
      h.eventRead = "down";
      await renderVerify(config);
      h.eventRead = "found";

      await enterCode(config);

      await waitFor(() => expect(h.replace).toHaveBeenCalledWith(page));
      expect(h.registerForEvent).toHaveBeenCalledWith(SLUG);
    },
  );
});
