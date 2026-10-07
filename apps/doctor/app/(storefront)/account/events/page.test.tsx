import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 014 EARS-6 on the doctor storefront (wave-2 entry gate row 24) — a guest
 * opening «Мои события» is sent to this host's door carrying the page as the
 * return target. Only the two Next request-scoped primitives are mocked: no
 * session cookie rides the request, so the package read answers «guest» without
 * a network call, and the route, the host config and the carry are the real ones.
 */
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import type { ReactElement } from "react";

import DoctorMyEventsPage from "./page";

/** Render the route's one mount: the async package route with its props. */
async function renderMount(searchParams: Record<string, string>) {
  const mount = (await DoctorMyEventsPage({
    searchParams: Promise.resolve(searchParams),
  })) as ReactElement<Record<string, unknown>>;
  const route = mount.type as (
    props: Record<string, unknown>,
  ) => Promise<unknown>;
  return route(mount.props);
}

beforeEach(() => {
  redirect.mockClear();
});

describe("014 EARS-6 doctor /account/events", () => {
  it("014 EARS-6: doctor host — a guest on /account/events lands on the door with returnTo=/account/events", async () => {
    await expect(renderMount({ tab: "recordings" })).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount%2Fevents",
    );
    expect(redirect).toHaveBeenCalledWith(
      "/login?returnTo=%2Faccount%2Fevents",
    );
  });
});
