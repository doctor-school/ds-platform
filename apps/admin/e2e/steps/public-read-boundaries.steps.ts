import { randomUUID } from "node:crypto";

import { addDoctorEventsFeedDays, doctorEventsFeedDayOf } from "@ds/schemas";
import { standHttpCredentials } from "@ds/e2e/stand-http-credentials";
import { expect, request, type APIRequestContext } from "@playwright/test";

import { Given, When, Then, type AdminWorld } from "../support/fixtures";

type Event = { id: string; slug: string; state: string; startsAt: string };
type Extent = {
  today: string;
  from: string;
  to: string;
  remaining: number;
  nextCount: number | null;
  nextBatch: number;
};
type Feed = {
  data?: Event[];
  days?: { items: Event[] }[];
  horizon?: Extent;
  remaining?: number;
  nextCount?: number | null;
  nextBatch?: number;
  nextFrom?: string | null;
  pagination?: { nextCursor: string | null; hasMore: boolean };
  today?: string;
  from?: string;
  to?: string;
  totalCount?: number;
};
const states = new WeakMap<
  AdminWorld,
  {
    doctors?: Event;
    experts?: Event;
    doctorFeed?: Event[];
    academyFeed?: Event[];
    empty?: { status: number; body: unknown };
    unknown?: { status: number; type: string; body: unknown };
  }
>();
function state(world: AdminWorld) {
  let value = states.get(world);
  if (!value) {
    value = {};
    states.set(world, value);
  }
  return value;
}
function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} must select the existing public-read fixture`);
  return value;
}
async function publicContext<T>(
  read: (api: APIRequestContext) => Promise<T>,
): Promise<T> {
  const credentials = standHttpCredentials();
  const api = await request.newContext({
    baseURL: required("E2E_API_URL"),
    ...(credentials ? { httpCredentials: credentials } : {}),
    storageState: { cookies: [], origins: [] },
  });
  try {
    return await read(api);
  } finally {
    await api.dispose();
  }
}
async function event(api: APIRequestContext, slug: string): Promise<Event> {
  const response = await api.get(
    `/v1/public/events/${encodeURIComponent(slug)}`,
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ slug, state: "published" });
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/u);
  expect(Number.isFinite(Date.parse(body.startsAt))).toBe(true);
  return body;
}
Given(
  "one public source has no eligible related rows and another source is draft, retired or unknown",
  async ({ world }) => {
    const slug = required("E2E_TAXONOMY_EMPTY_EVENT_SLUG");
    await publicContext(async (api) => {
      const positive = await api.get(`/v1/public/events/${slug}`);
      expect(positive.status()).toBe(200);
      expect((await positive.json()).slug).toBe(slug);
    });
    state(world);
  },
);
When(
  "a zero-auth caller reads the same relationship direction for each source",
  async ({ world }) => {
    await publicContext(async (api) => {
      const empty = await api.get(
        `/v1/public/events/${required("E2E_TAXONOMY_EMPTY_EVENT_SLUG")}/projects`,
      );
      const unknown = await api.get(
        `/v1/public/events/unknown-${randomUUID()}/projects`,
      );
      state(world).empty = { status: empty.status(), body: await empty.json() };
      state(world).unknown = {
        status: unknown.status(),
        type: unknown.headers()["content-type"] ?? "",
        body: await unknown.json(),
      };
      expect(
        (await api.storageState()).cookies
          .map((cookie) => cookie.name)
          .filter((name) => name !== "ds_stage_gate"),
      ).toEqual([]);
    });
  },
);
Then(
  "the eligible source returns 200 with empty data, null nextCursor and hasMore false",
  async ({ world }) => {
    expect(state(world).empty).toEqual({
      status: 200,
      body: { data: [], pagination: { nextCursor: null, hasMore: false } },
    });
  },
);
Then(
  "the ineligible source returns 404 RESOURCE_NOT_FOUND Problem Details",
  async ({ world }) => {
    const answer = state(world).unknown;
    expect(answer?.status).toBe(404);
    expect(answer?.type).toContain("application/problem+json");
    expect(answer?.body).toMatchObject({
      status: 404,
      errorCode: "RESOURCE_NOT_FOUND",
      title: expect.any(String),
      traceId: expect.any(String),
    });
  },
);
Given("a published event with the audience doctors", async ({ world }) => {
  state(world).doctors = await publicContext((api) =>
    event(api, required("E2E_TAXONOMY_DOCTORS_EVENT_SLUG")),
  );
});
Given("a published event with the audience experts", async ({ world }) => {
  state(world).experts = await publicContext((api) =>
    event(api, required("E2E_TAXONOMY_EXPERTS_EVENT_SLUG")),
  );
  expect(state(world).experts!.id).not.toBe(state(world).doctors!.id);
});
function complete(
  body: Feed,
  from: string,
  to: string,
  fixtureDays: string[],
): Event[] {
  const extent = body.horizon ?? body;
  expect(extent.from).toBe(from);
  expect(typeof extent.to).toBe("string");
  expect(extent.to! <= to).toBe(true);
  const entries = body.data ?? body.days?.flatMap((day) => day.items);
  expect(Array.isArray(entries)).toBe(true);
  expect(
    entries!.length,
    "500-row cap must not hide sibling events",
  ).toBeLessThan(500);
  if (body.totalCount !== undefined)
    expect(body.totalCount).toBe(entries!.length);
  if (fixtureDays.some((day) => day >= extent.to!)) {
    // Canonical exhaustion clamp: event-horizon.ts:303; event-horizon.spec.ts:87.
    expect(extent.remaining).toBe(0);
    expect(extent.nextCount).toBeNull();
    expect(extent.nextBatch).toBe(0);
    if (body.data)
      expect(body.pagination).toEqual({ nextCursor: null, hasMore: false });
    else expect(body.nextFrom).toBeNull();
    expect(entries!.length).toBeGreaterThan(0);
    const farthest = entries!
      .map((item) => doctorEventsFeedDayOf(new Date(item.startsAt)))
      .sort()
      .at(-1)!;
    expect(extent.to).toBe(addDoctorEventsFeedDays(farthest, 1));
  }
  return entries!;
}
When(
  "the doctor storefront and the Academy read their events",
  async ({ world }) => {
    const current = state(world);
    if (!current.doctors || !current.experts)
      throw new Error("Both audience controls are required");
    await publicContext(async (api) => {
      const initial = await api.get("/v1/public/events?timeframe=upcoming");
      expect(initial.status()).toBe(200);
      const from = (await initial.json()).horizon.today as string;
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      const days = [current.doctors!, current.experts!]
        .map((item) => doctorEventsFeedDayOf(new Date(item.startsAt)))
        .sort();
      for (const day of days) expect(day >= from).toBe(true);
      const to = addDoctorEventsFeedDays(days[1]!, 1);
      const academy = await api.get(
        `/v1/public/events?timeframe=upcoming&from=${from}&to=${to}`,
      );
      const doctor = await api.get(
        `/v1/storefront/doctor/events?tense=upcoming&specialty=all&from=${from}&to=${to}`,
      );
      expect(academy.status()).toBe(200);
      expect(doctor.status()).toBe(200);
      current.academyFeed = complete(await academy.json(), from, to, days);
      current.doctorFeed = complete(await doctor.json(), from, to, days);
      expect(
        (await api.storageState()).cookies
          .map((cookie) => cookie.name)
          .filter((name) => name !== "ds_stage_gate"),
      ).toEqual([]);
    });
  },
);
Then(
  "the doctors-audience event is read only by the doctor storefront",
  async ({ world }) => {
    const current = state(world);
    expect(current.doctorFeed).toContainEqual(
      expect.objectContaining({
        id: current.doctors!.id,
        slug: current.doctors!.slug,
      }),
    );
    expect(current.academyFeed!.map((item) => item.id)).not.toContain(
      current.doctors!.id,
    );
  },
);
Then(
  "the experts-audience event is read only by the Academy",
  async ({ world }) => {
    const current = state(world);
    expect(current.academyFeed).toContainEqual(
      expect.objectContaining({
        id: current.experts!.id,
        slug: current.experts!.slug,
      }),
    );
    expect(current.doctorFeed!.map((item) => item.id)).not.toContain(
      current.experts!.id,
    );
  },
);
