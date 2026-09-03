import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInAsAdmin } from "./support/sign-in";

/**
 * 014 EARS-25 / EARS-27 (#1741 slice 2b), browser half — what an operator SEES
 * on an off-platform (`legacy`) эфир.
 *
 * The unit rows (`lib/lifecycle.test.ts`) prove the edge→command derivation and
 * the API e2e proves the two commands; neither can prove the thing this feature
 * is actually about, which is that ONE screen speaks ONE machine's vocabulary.
 * An archived эфир the platform never hosted is administered with «Архивировать»
 * / «Скрыть» and shows the status «Архивирован»; the platform commands
 * («Опубликовать», «Открыть эфир», «Закрыть эфир») and the stream-config
 * affordance never appear beside them (014-design §3.1, EARS-27). This spec
 * drives that on the running admin, in both directions of the legacy machine.
 *
 * It replaces `event-lifecycle.spec.ts`, deleted in slice 1 when 014 EARS-23
 * removed the `published → ended` fork the old spec was written around.
 *
 * The fixtures are the SEEDED ones, not events created through the form: the
 * 007 create form authors `platform` events only — `origin` is rejected on
 * write (`EventAdminCreate.origin: z.never()`), so a legacy эфир cannot be
 * produced through the UI at all. `seed-006-legacy-archived` is the one legacy
 * fixture (`in_archive`, rutube recording) and `seed-005-hidden` the platform
 * contrast row. Because they are shared stand rows rather than throwaways, the
 * spec RESTORES the legacy эфир to `in_archive` in a `finally` — it leaves the
 * stand exactly as it found it.
 *
 * `E2E_SHOT_DIR` opts into the render evidence the PR body cites — the
 * in_archive detail at two widths × both palettes, plus the interaction strip
 * after «Скрыть» and after «Архивировать». Unset, the spec still asserts: the
 * images are evidence for a human, not the gate.
 *
 * Runs in CI, in the `admin-e2e` job's «Admin flows tier» step, against a
 * database that job migrates (`drizzle:migrate:ci`) and seeds («Seed the
 * admin-flows fixtures» = `pnpm --filter @ds/api seed:events`) — that seed step
 * exists for this spec, because a `legacy` эфир cannot be authored through any
 * admin or API path until 014 slice 3. Locally it runs the same way against a
 * booted branch stand; the bootstrap provisions a real `platform_admin` against
 * the stand's Zitadel and throws when `IDP_*` is absent, so a stray invocation
 * fails fast rather than pretending to pass. Locally:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/legacy-lifecycle.spec.ts
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;

/** The phone width the admin narrow specs (#1387/#1399) are measured at. */
const NARROW = { width: 390, height: 844 };
/** A desktop width comfortably past every admin breakpoint. */
const WIDE = { width: 1440, height: 900 };

/** `seed-006-legacy-archived` — the ONE `legacy` эфир on the stand. */
const LEGACY_TITLE = "Архивный эфир: инсулинотерапия (до платформы)";
/** `seed-005-hidden` — a `platform` event in the SAME `hidden` state. */
const HIDDEN_PLATFORM_TITLE = "Скрыт: базовая ЭКГ для терапевта";

/** The owner-approved legacy copy (`messages/ru.json`). */
const ARCHIVED_BADGE = "Архивирован";
const HIDDEN_BADGE = "Скрыто";
const ARCHIVE_LABEL = "Архивировать";
const HIDE_LABEL = "Скрыть";
/** The platform-only affordance that must never share the screen (EARS-27). */
const STREAM_SECTION = "Настройка трансляции";

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}

/**
 * Render the page under the design-system dark palette. The admin ships no theme
 * toggle of its own — the palette is the `.dark` token block in
 * `@ds/design-system` (`styles/tokens.css`), which is what a dark-mode host
 * applies — so the dark evidence is captured by putting the app under exactly
 * that class rather than by inventing a control this surface does not have.
 */
async function setPalette(page: Page, palette: "light" | "dark"): Promise<void> {
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, palette);
}

/**
 * Resolve a seeded event's id by walking the real admin list, page by page, to
 * the row carrying its title. The list is the only place the admin surfaces an
 * event id, and a hardcoded uuid would rot the moment the stand is re-seeded.
 */
async function findEventIdByTitle(page: Page, title: string): Promise<string> {
  await page.goto("/events");
  await expect(page.getByTestId("events-table")).toBeVisible({
    timeout: 20_000,
  });

  for (;;) {
    const row = page.locator("tr", { hasText: title }).first();
    if ((await row.count()) > 0) {
      const testId = await row.getAttribute("data-testid");
      const id = testId?.replace("event-row-", "");
      expect(id, `event row for «${title}» carries an id`).toBeTruthy();
      return id!;
    }
    const next = page.getByTestId("events-next");
    if (await next.isDisabled()) {
      throw new Error(
        `Seeded event «${title}» is not in the admin list — is the branch DB seeded (pnpm --filter @ds/api seed:events)?`,
      );
    }
    await next.click();
    await expect(page.getByTestId("events-table")).toBeVisible();
  }
}

/** Every platform lifecycle control, by the test id `lib/lifecycle` assigns it. */
const PLATFORM_ACTIONS = [
  "action-publish",
  "action-open",
  "action-close",
  "action-hide",
];

/** Assert the bar speaks the legacy machine's vocabulary and only that. */
async function expectNoPlatformVocabulary(page: Page): Promise<void> {
  for (const testId of PLATFORM_ACTIONS) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }
  // The stream config belongs to the platform эфир that runs in the 006 room; a
  // legacy эфир was broadcast elsewhere and has no room to configure.
  await expect(page.getByText(STREAM_SECTION)).toHaveCount(0);
}

/**
 * Put the shared legacy fixture back into `in_archive` through the API.
 *
 * Deliberately NOT a «Архивировать» click: a UI restore only runs while the page
 * is still healthy, and the page is exactly what has just failed whenever this
 * matters — an interrupted or timed-out run would otherwise strand the stand's
 * ONE legacy эфир in `hidden`, where a later reader of the archive sees nothing.
 * `page.request` reuses the signed-in session's cookies and goes through the
 * admin's same-origin `/v1/:path*` proxy, so no second auth is needed; the
 * command carries the same fenced-write protocol headers the data provider
 * sends (canonical `Idempotency-Key` + `If-Match: W/"<version>"`, 012-design §6).
 * A 409 is the benign «already `in_archive`» — the fixture is in the wanted
 * state either way — so it is tolerated; anything else is worth failing on.
 */
async function restoreLegacyToArchive(
  page: Page,
  eventId: string,
): Promise<void> {
  const detail = await page.request.get(`/v1/admin/events/${eventId}`);
  if (!detail.ok()) {
    throw new Error(
      `legacy fixture restore could not read the event: ${detail.status()}`,
    );
  }
  const { state, version } = (await detail.json()) as {
    state: string;
    version: number;
  };
  if (state === "in_archive") return;

  const restored = await page.request.post(
    `/v1/admin/events/${eventId}/archive-legacy`,
    {
      data: {},
      headers: {
        "idempotency-key": crypto.randomUUID(),
        "if-match": `W/"${version}"`,
      },
    },
  );
  if (!restored.ok() && restored.status() !== 409) {
    throw new Error(
      `legacy fixture restore failed: ${restored.status()} ${await restored.text()}`,
    );
  }
}

test.describe.configure({ mode: "serial" });

test.describe("014 EARS-25/27 — the legacy broadcast lifecycle bar in the live admin", () => {
  test("014 EARS-25: an in_archive legacy эфир shows «Архивирован» and only «Скрыть»; «Скрыть» then leaves only «Архивировать», and «Архивировать» returns it", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);

    const eventId = await findEventIdByTitle(page, LEGACY_TITLE);
    await page.goto(`/events/${eventId}`);

    let restored = true;
    try {
      // ── 014 EARS-25.1: the archived эфир, as the operator finds it. ───────
      const archivedBadge = page.getByTestId("state-in_archive");
      await expect(archivedBadge).toBeVisible({ timeout: 20_000 });
      await expect(archivedBadge).toHaveText(ARCHIVED_BADGE);

      const hideLegacy = page.getByTestId("action-hide-legacy");
      await expect(hideLegacy).toBeVisible();
      await expect(hideLegacy).toHaveText(HIDE_LABEL);
      // The bar offers the legacy machine's ONE move out of `in_archive` and
      // nothing else — not even the other legacy command.
      await expect(page.getByTestId("action-archive-legacy")).toHaveCount(0);
      await expectNoPlatformVocabulary(page);

      await shot(page, "in-archive-desktop-light");
      await setPalette(page, "dark");
      await shot(page, "in-archive-desktop-dark");
      await page.setViewportSize(NARROW);
      await shot(page, "in-archive-mobile-dark");
      await setPalette(page, "light");
      await shot(page, "in-archive-mobile-light");
      await page.setViewportSize(WIDE);

      // ── 014 EARS-25.2: «Скрыть» moves it onto the other side of the SAME
      //    machine — the status becomes «Скрыто» and the bar now offers only
      //    «Архивировать». The platform vocabulary stays absent throughout:
      //    `hidden` is a state BOTH machines have, and it is exactly where a
      //    leak between them would show. ─────────────────────────────────────
      restored = false;
      await hideLegacy.click();

      const hiddenBadge = page.getByTestId("state-hidden");
      await expect(hiddenBadge).toBeVisible({ timeout: 20_000 });
      await expect(hiddenBadge).toHaveText(HIDDEN_BADGE);

      const archiveLegacy = page.getByTestId("action-archive-legacy");
      await expect(archiveLegacy).toBeVisible();
      await expect(archiveLegacy).toHaveText(ARCHIVE_LABEL);
      await expect(page.getByTestId("action-hide-legacy")).toHaveCount(0);
      await expectNoPlatformVocabulary(page);
      await expect(page.getByTestId("transition-error")).toHaveCount(0);

      await shot(page, "interaction-2-hidden-desktop-light");

      // ── And back: «Архивировать» is the return edge, so the operator can
      //    undo a mistaken hide without a DB round-trip. ───────────────────
      await archiveLegacy.click();
      await expect(page.getByTestId("state-in_archive")).toBeVisible({
        timeout: 20_000,
      });
      restored = true;
      await expect(page.getByTestId("action-hide-legacy")).toBeVisible();
      await expect(page.getByTestId("transition-error")).toHaveCount(0);

      await shot(page, "interaction-3-archived-again-desktop-light");
    } finally {
      // The stand fixture is SHARED: leave the эфир in the `in_archive` state
      // the seed defines, whatever happened above. The restore goes through the
      // API, not a click: a UI restore only runs if the page survived, and the
      // page is exactly what has just failed when this matters. `page.request`
      // carries the same session cookies through the admin's same-origin
      // `/v1/:path*` proxy, so no second auth is needed. A 409 here is the
      // benign «already in_archive» — the эфир is in the wanted state either
      // way, so it is tolerated; anything else is worth seeing.
      if (!restored) {
        await restoreLegacyToArchive(page, eventId);
      }
    }
  });

  test("014 EARS-27: a hidden PLATFORM event offers no «Архивировать» — the same state on the other machine has none of the legacy vocabulary", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.setViewportSize(WIDE);

    const eventId = await findEventIdByTitle(page, HIDDEN_PLATFORM_TITLE);
    await page.goto(`/events/${eventId}`);

    const hiddenBadge = page.getByTestId("state-hidden");
    await expect(hiddenBadge).toBeVisible({ timeout: 20_000 });
    await expect(hiddenBadge).toHaveText(HIDDEN_BADGE);

    // `hidden` is terminal on the platform machine (007 EARS-7): the bar shows
    // the «no transitions» notice. The legacy `hidden → in_archive` edge exists
    // in the SAME table this bar derives from, so if the two machines could leak
    // into one another, «Архивировать» would be sitting right here.
    await expect(page.getByTestId("no-transitions")).toBeVisible();
    await expect(page.getByTestId("action-archive-legacy")).toHaveCount(0);
    await expect(page.getByTestId("action-hide-legacy")).toHaveCount(0);
    // …and the platform affordances this event DOES own are untouched by the
    // legacy guard: the stream section still renders here.
    await expect(page.getByText(STREAM_SECTION).first()).toBeVisible();

    await shot(page, "hidden-platform-contrast-desktop-light");
  });
});
