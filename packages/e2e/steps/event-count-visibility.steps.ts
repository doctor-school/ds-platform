import { createBdd, test as base } from "playwright-bdd";
import { expect } from "@playwright/test";
import {
  bootEventCountApi,
  EventCountWorld,
  type CountApi,
} from "../lib/event-count-fixture.js";
import { eventCountOriginals } from "../lib/event-count-report.js";
import { openEventLive } from "../admin/events.js";

export const test = base.extend<
  { counts: EventCountWorld },
  { countApi: CountApi }
>({
  countApi: [
    async ({ browserName }, use) => {
      expect(browserName).toBe("chromium");
      const api = await bootEventCountApi();
      try {
        await use(api);
      } finally {
        await api.close();
      }
    },
    { scope: "worker" },
  ],
  counts: async ({ page, countApi }, use, info) => {
    const title = info.title.replace(/ @host:admin$/, "");
    const ordinal = eventCountOriginals.indexOf(
      title as (typeof eventCountOriginals)[number],
    );
    expect(ordinal).toBeGreaterThanOrEqual(0);
    const counts = new EventCountWorld(countApi, page, title, ordinal);
    try {
      await counts.initialize(page.context());
      await use(counts);
    } finally {
      await counts.cleanup();
    }
  },
});
const { Given, When, Then } = createBdd(test);
Given(
  /^the admin app is served on its configured origin with a platform_admin session \(feature 003\)$/,
  async ({ counts }) => counts.background("admin"),
);
Given(
  /^the object storage \(MinIO\/Timeweb\) is available for the program PDF$/,
  async ({ counts }) => counts.background("pdf"),
);
Given(
  "EventLifecycleState has the closed set draft, published, live, ended, hidden, in_archive with origin selecting the disjoint platform lifecycle draft → published → live → ended → hidden or legacy lifecycle in_archive ⇄ hidden",
  async ({ counts }) => counts.background("lifecycles"),
);
Given(
  "all absolute times are entered as МСК and stored as one canonical instant",
  async ({ counts }) => counts.background("msk"),
);
Given(
  /^the public event page and listing \(feature 004\), registration \(feature 005\), and the room \(feature 006\) read the state 007 writes$/,
  async ({ counts }) => counts.background("consumers"),
);

Given(
  "an operator creating an event without touching the «Скрыть число записавшихся» option",
  async ({ counts }) => counts.fillCreateForm("Untouched default"),
);
When("the operator saves the event", async ({ counts }) => {
  counts.eventId = await counts.saveNewEvent("Untouched default");
});
Then(
  "the event persists hide_sign_up_count true, because the option is on by default",
  async ({ counts }) => counts.persistedOption("hide_sign_up_count", true),
);
Then(
  "the editor shows the option as on when the event is reopened",
  async ({ counts }) =>
    counts.reopen(
      counts.ordinal === 2 ? "show-presence-count" : "hide-sign-up-count",
      true,
    ),
);
Then(
  "a public read of the event carries signUpCount null",
  async ({ counts }) => {
    await counts.publish(counts.eventId);
    expect((await counts.detail(counts.eventId)).hideSignUpCount).toBe(true);
    const read = await counts.publicRead(counts.eventId);
    expect(read.card.signUpCount).toBeNull();
    expect(read.pageBody.signUps).toBeNull();
    counts.observedCount = null;
  },
);

Given(
  "an event with registrants and the «Скрыть число записавшихся» option on by default",
  async ({ counts }) => {
    counts.eventId = await counts.createEvent("Registrant count", true);
    expect((await counts.detail(counts.eventId)).hideSignUpCount).toBe(true);
    expect(
      (await counts.doctor("POST", counts.eventId, "registration")).body
        .registered,
    ).toBe(true);
    expect(
      (await counts.publicRead(counts.eventId)).card.signUpCount,
    ).toBeNull();
  },
);
When(
  "the operator turns the option off and saves the event",
  async ({ counts }) => counts.toggleAndSave("hide-sign-up-count"),
);
Then("the event persists hide_sign_up_count false", async ({ counts }) =>
  counts.persistedOption("hide_sign_up_count", false),
);
Then(
  "the editor shows the option as off when the event is reopened",
  async ({ counts }) => counts.reopen("hide-sign-up-count", false),
);
Then(
  "a public read of the event carries the registrant count as signUpCount",
  async ({ counts }) => {
    const read = await counts.publicRead(counts.eventId);
    expect(read.card.signUpCount).toBe(1);
    expect((read.pageBody.signUps as { total: number }).total).toBe(1);
    counts.observedCount = read.card.signUpCount as number;
  },
);

Given(
  "an event with the «Показывать зрителям число участников» option off by default",
  async ({ counts }) => {
    counts.eventId = await counts.createEvent("Live participant count", true);
    expect((await counts.detail(counts.eventId)).showPresenceCount).toBe(false);
    await expect(
      counts.page.getByTestId("show-presence-count"),
    ).not.toBeChecked();
    await openEventLive(counts.page);
    expect(
      (await counts.doctor("POST", counts.eventId, "registration")).body
        .registered,
    ).toBe(true);
    expect(
      (await counts.doctor("POST", counts.eventId, "heartbeat")).body
        .presenceCount,
    ).toBeNull();
    expect(
      (await counts.doctor("GET", counts.eventId, "room")).body.presenceCount,
    ).toBeNull();
  },
);
When(
  "the operator turns the option on and saves the event",
  async ({ counts }) => counts.toggleAndSave("show-presence-count"),
);
Then("the event persists show_presence_count true", async ({ counts }) =>
  counts.persistedOption("show_presence_count", true),
);
Then(
  "a registered doctor's room read of the live event carries the presence count",
  async ({ counts }) => {
    const room = await counts.doctor("GET", counts.eventId, "room");
    expect(room.body.eventId).toBe(counts.eventId);
    expect(room.body.presenceCount).toBe(1);
    counts.observedCount = room.body.presenceCount as number;
  },
);
