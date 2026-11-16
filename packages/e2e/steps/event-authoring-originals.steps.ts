import { createBdd, test as base } from "playwright-bdd";
import { expect } from "@playwright/test";
import {
  bootEventAuthoringRuntime,
  type AuthoringRuntime,
} from "../lib/event-authoring-runtime.js";
import { EventAuthoringWorld } from "../lib/event-authoring-world.js";
import { eventAuthoringCases } from "../lib/event-authoring-report.js";
import { proveDraftProjections } from "../lib/event-authoring-projections.js";

export const test = base.extend<
  { authoring: EventAuthoringWorld },
  { authoringRuntime: AuthoringRuntime }
>({
  authoringRuntime: [
    async ({ browserName }, use) => {
      expect(browserName).toBe("chromium");
      const runtime = await bootEventAuthoringRuntime();
      try {
        await use(runtime);
      } finally {
        await runtime.close();
      }
    },
    { scope: "worker" },
  ],
  page: async ({ browser, authoringRuntime }, use) => {
    const context = await browser.newContext({
      baseURL: authoringRuntime.origins.admin!,
      locale: "ru-RU",
      userAgent: "EventCount4061/1.0",
      timezoneId: "America/New_York",
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
  authoring: async ({ page, authoringRuntime }, use, info) => {
    const title = info.title.replace(/ @host:admin$/, "");
    const ordinal = eventAuthoringCases.findIndex((row) => row.title === title);
    expect(ordinal).toBeGreaterThanOrEqual(0);
    const world = new EventAuthoringWorld(
      authoringRuntime,
      page,
      title,
      ordinal,
    );
    try {
      await world.initialize(page.context());
      await use(world);
    } finally {
      await world.cleanup();
    }
  },
});
const { Given, When, Then } = createBdd(test);
Given(
  /^the admin app is served on its configured origin with a platform_admin session \(feature 003\)$/,
  async ({ authoring }) => authoring.background("admin"),
);
Given(
  /^the object storage \(MinIO\/Timeweb\) is available for the program PDF$/,
  async ({ authoring }) => authoring.background("pdf"),
);
Given(
  "EventLifecycleState has the closed set draft, published, live, ended, hidden, in_archive with origin selecting the disjoint platform lifecycle draft → published → live → ended → hidden or legacy lifecycle in_archive ⇄ hidden",
  async ({ authoring }) => authoring.background("lifecycles"),
);
Given(
  "all absolute times are entered as МСК and stored as one canonical instant",
  async ({ authoring }) => authoring.background("msk"),
);
Given(
  /^the public event page and listing \(feature 004\), registration \(feature 005\), and the room \(feature 006\) read the state 007 writes$/,
  async ({ authoring }) => authoring.background("consumers"),
);
Given("a platform_admin operator in the admin app", async ({ authoring }) => {
  expect(authoring.adminRoles).toEqual(["platform_admin"]);
});
When(
  "the operator creates an event with a date and time entered as МСК",
  async ({ authoring }) => authoring.createDraft(),
);
Then("the event is created in the draft state", async ({ authoring }) => {
  expect((await authoring.detail(authoring.eventId)).state).toBe("draft");
});
Then(
  "the entered МСК time is stored as one canonical instant",
  async ({ authoring }) => {
    const detail = await authoring.detail(authoring.eventId);
    expect(detail.startsAt).toBe(
      new Date(
        `${authoring.events.get(authoring.eventId)!.msk}:00+03:00`,
      ).toISOString(),
    );
  },
);
Then(
  "the event is absent from every public surface until it is published",
  async ({ authoring }) => proveDraftProjections(authoring),
);
Given(
  "a platform_admin operator configuring the stream of an event",
  async ({ authoring }) => {
    authoring.eventId = await authoring.createEvent("explicit provider", false);
  },
);
When(
  "the operator selects provider {string} and sets an embed reference",
  async ({ authoring }, provider: string) =>
    authoring.persistProvider(provider),
);
Then(
  "the stream config records provider {string} and the embed reference",
  async ({ authoring }, provider: string) => authoring.verifyProvider(provider),
);
Then(
  /^the room \(feature 006\) instantiates the player from exactly this config, never from the URL$/,
  async ({ authoring, browser }) => authoring.player(browser),
);
Given(
  "a published event whose stream config has the wrong embed reference",
  async ({ authoring }) => authoring.wrongPublished(),
);
When(
  "the operator corrects the embed reference before opening the room",
  async ({ authoring }) => authoring.correct(),
);
Then("the updated stream config is recorded", async ({ authoring }) =>
  authoring.verifyCorrection(),
);
Then(/^no state reversal \(unpublish\) was needed$/, async ({ authoring }) => {
  expect((await authoring.detail(authoring.eventId)).state).toBe("published");
  expect(await authoring.lifecycle()).toEqual(authoring.proof.lifecycleBefore);
});
