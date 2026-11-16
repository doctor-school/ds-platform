import { describe, expect, it, vi } from "vitest";
import type { PointsAccount } from "@ds/schemas";

import { createLearningClient, pointsPlateBalances } from "./index";

// 024 EARS-14 — the course path and step screen mount the 025 points plate over
// the caller's own account read `GET /v1/me/points`.

const ACCOUNT: PointsAccount = {
  personId: "00000000-0000-4000-8000-000000000001",
  pul: { unit: "Pul", available: 120, reserved: 30 },
  bre: 34,
  con: 12,
  advance: { open: 0, remaining: 0 },
  status: "open",
};

describe("the points read for the plate", () => {
  it("EARS-14: reads the caller's own account from GET /v1/me/points with the forwarded session", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(ACCOUNT), { status: 200 }),
    );
    const client = createLearningClient({
      baseUrl: "http://api",
      headers: { cookie: "s=1" },
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(await client.myPoints()).toEqual(ACCOUNT);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/v1/me/points");
    expect(init.headers).toMatchObject({ cookie: "s=1" });
  });

  it("EARS-14: the plate shows the Pul the person may spend, Bre and Con", () => {
    expect(pointsPlateBalances(ACCOUNT)).toEqual({
      pul: 120,
      bre: 34,
      con: 12,
    });
  });
});
