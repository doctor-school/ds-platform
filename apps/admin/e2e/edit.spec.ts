import {
  createPublishedEvent,
  retireEventFromStorefronts,
  signInAsAdmin,
} from "@ds/e2e/admin-events";
import { expect, test, type Page } from "@playwright/test";
import { evidenceShot } from "./support/evidence-shot";

/**
 * 007 EARS-12 (#2913), browser half — the event editor's «Скрыть число
 * записавшихся».
 *
 * The unit rows (`lib/event-form-fields.test.ts`, `lib/event-create-vars.test.ts`,
 * `lib/event-update-vars.test.ts`) prove the projection and the request bodies;
 * the API e2e (`apps/api/test/admin/edit-event.e2e-spec.ts`) proves the column.
 * What only a browser proves is the operator's round trip: the option is on for
 * a new event (#3479 — hidden unless the operator turns it off), so the public
 * read serves `signUpCount: null` (019 EARS-19); unticking it and saving
 * persists it (the reopened editor shows it off) and brings the number back;
 * ticking it again hides the number.
 *
 * The spec creates its OWN published event (titled with the run's timestamp, so
 * a re-run never collides) and takes it off every storefront at the end.
 *
 * `E2E_SHOT_DIR` opts into the render evidence the PR body cites — the edit form
 * with the option ON, at 1440 and 390, light and dark (`support/evidence-shot.ts`).
 *
 * Dev-stand-gated like every `apps/admin/e2e` flow spec (see
 * `playwright.flows.config.ts`): the bootstrap provisions a real `platform_admin`
 * and throws when `IDP_*` is absent.
 */
const OPTION_LABEL = "Скрыть число записавшихся";

/** The bare public Academy read (`GET /v1/public/events`) — the event's `signUpCount`. */
async function publicSignUpCount(
  page: Page,
  eventId: string,
): Promise<number | null | undefined> {
  const read = await page.evaluate(async (id) => {
    // `no-store`: the read is `Cache-Control: public, max-age=30`, and the
    // browser would otherwise answer the second read from the first.
    const res = await fetch("/v1/public/events", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const cards = res.ok
      ? ((await res.json()) as { id: string; signUpCount: number | null }[])
      : [];
    const card = cards.find((c) => c.id === id);
    return {
      status: res.status,
      found: Boolean(card),
      count: card?.signUpCount,
    };
  }, eventId);
  expect(read.status, "public events read").toBe(200);
  expect(read.found, "the published event is on the public read").toBe(true);
  return read.count;
}

/**
 * Toggle a DS `Checkbox` the way a user does: the real input is `sr-only` behind
 * its painted box, so the click goes to the wrapping `<label>` (the
 * `legacy-broadcast.spec.ts` precedent).
 */
async function toggle(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
}

async function saveAndReopen(page: Page, eventId: string): Promise<void> {
  await page.getByTestId("submit-event").click();
  await expect(page.getByTestId("edit-ok")).toBeVisible({ timeout: 20_000 });
  await page.goto(`/events/${eventId}`);
  await expect(page.getByTestId("event-form")).toBeVisible();
}

test.describe("007 EARS-12 — «Скрыть число записавшихся» in the event editor", () => {
  test("007 EARS-12: the create form offers the option ticked (#3479), and not on an архивный эфир", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/events/create");
    const option = page.getByLabel(OPTION_LABEL);
    await expect(option).toBeVisible();
    await expect(option).toBeChecked();
    // The legacy create body has no such key — the box is not offered there.
    await toggle(page, "legacy-toggle");
    await expect(page.getByTestId("legacy-toggle")).toBeChecked();
    await expect(page.getByTestId("hide-sign-up-count")).toHaveCount(0);
  });

  test("007 EARS-12 / 019 EARS-19: on by default, public count null; off → saved, reopened off, the number returns; on again → null", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await createPublishedEvent(
      page,
      `Скрытый счётчик ${Date.now()}`,
      { audience: "experts" },
    );
    try {
      const option = page.getByLabel(OPTION_LABEL);
      await expect(option).toBeChecked();
      expect(await publicSignUpCount(page, id)).toBeNull();
      await page.getByTestId("hide-sign-up-count").scrollIntoViewIfNeeded();
      await evidenceShot(page, "admin-edit-option-on");

      await toggle(page, "hide-sign-up-count");
      await expect(option).not.toBeChecked();
      await saveAndReopen(page, id);
      await expect(page.getByLabel(OPTION_LABEL)).not.toBeChecked();
      expect(typeof (await publicSignUpCount(page, id))).toBe("number");

      await toggle(page, "hide-sign-up-count");
      await expect(page.getByLabel(OPTION_LABEL)).toBeChecked();
      await saveAndReopen(page, id);
      await expect(page.getByLabel(OPTION_LABEL)).toBeChecked();
      expect(await publicSignUpCount(page, id)).toBeNull();
    } finally {
      await retireEventFromStorefronts(page, id);
    }
  });
});

/**
 * 007 EARS-13 (#2911), browser half — «Показывать зрителям число участников».
 * The unit rows prove the projection and the request bodies; the API e2e
 * (`apps/api/test/admin/show-presence-count.e2e-spec.ts`) proves the column and
 * the viewer-side withholding (006 EARS-19). The browser proves the operator's
 * round trip: off on a new event, absent on an архивный эфир, ticked → saved →
 * reopened on, unticked → saved → reopened off.
 */
const PRESENCE_OPTION_LABEL = "Показывать зрителям число участников";

test.describe("007 EARS-13 — «Показывать зрителям число участников» in the event editor", () => {
  test("007 EARS-13: the create form offers the option off, and not on an архивный эфир", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/events/create");
    const option = page.getByLabel(PRESENCE_OPTION_LABEL);
    await expect(option).toBeVisible();
    await expect(option).not.toBeChecked();
    await evidenceShot(page, "admin-create-presence-option-off");
    // The legacy create body has no such key — the box is not offered there.
    await toggle(page, "legacy-toggle");
    await expect(page.getByTestId("legacy-toggle")).toBeChecked();
    await expect(page.getByTestId("show-presence-count")).toHaveCount(0);
  });

  test("007 EARS-13: on → saved, reopened on; off → saved, reopened off", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await createPublishedEvent(
      page,
      `Счётчик в комнате ${Date.now()}`,
      { audience: "experts" },
    );
    try {
      const option = page.getByLabel(PRESENCE_OPTION_LABEL);
      await expect(option).not.toBeChecked();

      await toggle(page, "show-presence-count");
      await expect(option).toBeChecked();
      await saveAndReopen(page, id);
      await expect(page.getByLabel(PRESENCE_OPTION_LABEL)).toBeChecked();
      await page.getByTestId("show-presence-count").scrollIntoViewIfNeeded();
      await evidenceShot(page, "admin-edit-presence-option-on");

      await toggle(page, "show-presence-count");
      await expect(page.getByLabel(PRESENCE_OPTION_LABEL)).not.toBeChecked();
      await saveAndReopen(page, id);
      await expect(page.getByLabel(PRESENCE_OPTION_LABEL)).not.toBeChecked();
    } finally {
      await retireEventFromStorefronts(page, id);
    }
  });
});

/**
 * 044 EARS-13 (#2517), browser half — «Место проведения» in the event editor.
 * The API e2e (`apps/api/test/admin/edit-event.e2e-spec.ts`) proves the column
 * and the null/blank clear; the browser proves the operator's round trip: an
 * event created with the box empty reopens empty, a typed place is saved and
 * reopened, an over-long place is refused on the field, and clearing the box
 * saves the venue away.
 */
test.describe("044 EARS-13 — «Место проведения» in the event editor", () => {
  const VENUE = "Москва, ГК «Милан», ул. Шипиловская, д. 28А";

  test("044 EARS-13: empty → filled and saved, reopened with the value; too long refused; cleared → saved empty", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const id = await createPublishedEvent(page, `Место ${Date.now()}`, {
      venue: null,
    });
    try {
      const venue = page.locator("#venue");
      await expect(page.getByLabel("Место проведения")).toBeVisible();
      await expect(venue).toHaveValue("");
      await venue.scrollIntoViewIfNeeded();
      await evidenceShot(page, "admin-venue-empty");

      // Reject: more than 300 characters is refused on the field, nothing saved.
      await venue.fill("м".repeat(301));
      await page.getByTestId("submit-event").click();
      await expect(page.getByTestId("edit-ok")).toHaveCount(0);
      await expect(venue).toHaveAttribute("aria-invalid", "true");

      // Accept: a typed place is saved and the reopened editor shows it.
      await venue.fill(`  ${VENUE}  `);
      await saveAndReopen(page, id);
      await expect(page.locator("#venue")).toHaveValue(VENUE);
      await page.locator("#venue").scrollIntoViewIfNeeded();
      await evidenceShot(page, "admin-venue-filled");

      // Cleared: the emptied box saves the venue away.
      await page.locator("#venue").fill("");
      await saveAndReopen(page, id);
      await expect(page.locator("#venue")).toHaveValue("");
    } finally {
      await retireEventFromStorefronts(page, id);
    }
  });
});
