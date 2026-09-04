import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { signInAsAdmin } from "./support/sign-in";
import { visible } from "./support/visible";

/**
 * 012 EARS-24 — the provenance-safe speaker-migration review surface.
 *
 * The admin surface is a THREE-STAGE command console, not a CRUD list, and the
 * spec walks it in the operator's own order: import the owner-reviewed
 * classification artifact, resolve every retained source row explicitly, record
 * the phase-aware release, then close the source.
 *
 * **Where the reviewed artifact comes from.** It is produced OFFLINE from a
 * database export (012-design §2.3): `event_speakers.id` is deliberately absent
 * from every wire contract — no admin route, no public projection and no queue
 * page exposes it before the import — precisely so that nothing in the running
 * system can synthesise the classification list the owner is supposed to have
 * reviewed by hand. The browser therefore cannot invent a VALID artifact, and
 * adding a route whose only consumer is this test would defeat the guarantee.
 * The spec reproduces the operator's real offline step instead:
 *
 * 1. it seeds legacy source rows the way an operator does before the cutover —
 *    through the event form's free-text speaker inputs (LD-1), including a
 *    same-name pair so the retained duplicates survive into the queue;
 * 2. it reads `event_speakers.id` back with a READ-ONLY `SELECT` against the
 *    database under test (`DATABASE_URL`), which is exactly the DBA export the
 *    owner classifies by hand in production;
 * 3. it classifies every retained row — the artifact must cover the source set
 *    EXACTLY, duplicates preserved, or the import is refused.
 *
 * `E2E_SPEAKER_MIGRATION_ARTIFACT` stays as the fallback for a tier that has a
 * running admin but no direct database handle: set it to
 * `{"reviewedRows":[{"sourceId":…,"classification":…}]}` and the accept arc uses
 * it verbatim. With neither the env var nor `DATABASE_URL`, the accept half
 * skips with that reason and the REFUSAL half still runs everywhere, including
 * CI: a list naming a source that is not in the retained set is rejected no
 * matter what that set is, and the assertion that nothing mutated is exactly
 * the property the import must never violate.
 *
 * Closure is TERMINAL and global (one singleton cutover row), so the accept arc
 * is a one-shot against a given database — re-run it against a fresh branch
 * database (`pnpm dev:db:branch 1607`), never against an already-closed one.
 *
 * Dev-stand-gated like the rest of `apps/admin/e2e` — it provisions a real
 * `platform_admin` and throws when the `IDP_*` env is absent. Run against a
 * booted admin + api:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 IDP_ISSUER=… IDP_SERVICE_TOKEN=… \
 *   IDP_PROJECT_ID=… pnpm --filter @ds/admin test:flows \
 *     e2e/taxonomy-speaker-migration.spec.ts
 */
const ARTIFACT = process.env.E2E_SPEAKER_MIGRATION_ARTIFACT;
const DATABASE_URL = process.env.DATABASE_URL;
const ARTIFACT_REASON =
  "neither DATABASE_URL nor E2E_SPEAKER_MIGRATION_ARTIFACT is set — the owner-reviewed classification artifact is produced offline from a database export (012-design §2.3) and cannot be synthesised from the wire contract";

/** A syntactically valid UUID that names no retained source row. */
const ALIEN_SOURCE_ID = "00000000-0000-4000-8000-0000000012ff";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** The phone width the admin narrow-layout specs use. */
const NARROW = { width: 390, height: 844 };

interface ReviewedRow {
  sourceId: string;
  classification: "unmatched" | "ambiguous" | "duplicate";
}

/** The three classifications, cycled so the queue facets have something to filter. */
const CLASSIFICATIONS: ReviewedRow["classification"][] = [
  "unmatched",
  "ambiguous",
  "duplicate",
];

/**
 * Seed legacy source rows through the product's own pre-cutover write path —
 * the event form's free-text speaker list (LD-1). The last two entries share a
 * name on purpose: the reconcile keeps duplicates as DISTINCT retained rows
 * (ADR-0003 design §3.6), and EARS-24 requires the queue to carry both.
 */
async function seedLegacySpeakers(page: Page): Promise<void> {
  const stamp = Date.now();
  const names = [
    `Мигрируемый Первый ${stamp}`,
    `Мигрируемый Второй ${stamp}`,
    `Мигрируемый Дубль ${stamp}`,
    `Мигрируемый Дубль ${stamp}`,
  ];
  await page.goto("/events/create");
  await expect(page.getByTestId("event-form")).toBeVisible();
  await page.locator("#title").fill(`Миграция докладчиков ${stamp}`);
  await page.locator("#school").fill("Кардиология");
  await page.locator("#startsAtMsk").fill("2026-09-17T19:00");
  await page.locator("#durationMin").fill("90");
  await page.getByTestId("program-pdf").setInputFiles({
    name: "program.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  });
  for (const [i, name] of names.entries()) {
    await page.getByTestId("add-speaker").click();
    await page.getByTestId(`speaker-name-${i}`).fill(name);
    await page.getByTestId(`speaker-regalia-${i}`).fill("д.м.н.");
  }
  await page.getByTestId("submit-event").click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
}

/**
 * One draft Expert for the «existing expert» resolution to point at. The queue
 * NEVER suggests a match, so the operator has to have somebody to pick: an
 * empty Expert book means there is nothing to resolve a source row onto.
 */
async function seedExpert(page: Page): Promise<void> {
  await page.goto("/experts/create");
  await page.getByTestId("expert-family-name").fill(`Приёмный-${Date.now()}`);
  await page.getByTestId("expert-given-name").fill("Эксперт");
  await page.getByTestId("expert-patronymic").fill("Существующий");
  await page.getByTestId("submit-expert").click();
  await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
}

/**
 * The DBA export the owner classifies by hand: every retained source row, in
 * the same stable `id` order the server compares against, duplicates preserved.
 * READ-ONLY — the spec never writes through this handle.
 */
async function exportRetainedSourceIds(): Promise<string[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM event_speakers ORDER BY id",
    );
    return result.rows.map((row) => row.id);
  } finally {
    await client.end();
  }
}

/**
 * The owner-reviewed classification list for the database under test — from
 * `E2E_SPEAKER_MIGRATION_ARTIFACT` when a tier has no database handle, else
 * seeded + exported live.
 */
async function reviewedRows(page: Page): Promise<ReviewedRow[]> {
  if (ARTIFACT) {
    return (JSON.parse(ARTIFACT) as { reviewedRows: ReviewedRow[] })
      .reviewedRows;
  }
  await seedLegacySpeakers(page);
  const sourceIds = await exportRetainedSourceIds();
  return sourceIds.map((sourceId, i) => ({
    sourceId,
    classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length]!,
  }));
}

async function openQueue(page: Page): Promise<void> {
  await page.getByTestId("nav-speaker-migration").click();
  await page.waitForURL(/\/speaker-migration$/);
  await expect(page.getByTestId("speaker-migration-state")).toBeVisible();
}

async function submitArtifact(page: Page, body: unknown): Promise<void> {
  await page.getByTestId("import-artifact").fill(JSON.stringify(body));
  await page.getByTestId("import-submit").click();
}

/**
 * Every row currently VISIBLE in the queue.
 *
 * `DataTable` renders each record twice — a desktop table (`hidden md:block`)
 * and a mobile card list (`md:hidden`) — so the row testid exists twice per
 * record and only the layout matching the viewport is visible. The shared
 * `visible()` filter makes every count mean "rows the operator sees", at any
 * width; see its doc for why this is the block's strategy, not a defect.
 */
function queueRows(page: Page): Locator {
  return visible(page.getByTestId(/^speaker-migration-row-/));
}

/**
 * The single reset-all control. `FilterBar` owns it and exposes no testid prop;
 * a second reset would break the block's one-clear-all contract. The empty-state
 * action deliberately carries different copy («Показать все записи»), so this
 * role query can never be ambiguous.
 */
function resetAllFilters(page: Page): Locator {
  return page.getByRole("button", { name: "Сбросить всё" });
}

/**
 * Ask the queue for the resolved rows too.
 *
 * The DS `Checkbox` keeps its real `<input>` visually hidden under the label
 * that paints the 22×22 box, so `check()` aims at the input and is intercepted
 * by the box it draws. A user clicks the LABEL — so does the spec.
 */
async function showResolvedRows(page: Page): Promise<void> {
  const input = page.getByTestId("filters-show-resolved");
  await input.locator("xpath=ancestor::label[1]").click();
  await expect(input).toBeChecked();
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-24 — provenance-safe speaker migration", () => {
  test("012 EARS-24: the console refuses an artifact that does not cover the retained source set, and changes nothing", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await openQueue(page);

    // The state panel is the operator's whole picture of the migration: the
    // phase, the queue counts, whether the artifact was ever imported, and the
    // rollback floor closure will install.
    const state = page.getByTestId("speaker-migration-state");
    await expect(state.getByTestId("state-phase")).toHaveText("Очередь открыта");
    await expect(state.getByTestId("state-import")).toHaveText(
      "Артефакт не импортирован",
    );
    await expect(state.getByTestId("state-release")).toHaveText(
      "Релиз не записан",
    );
    await expect(state.getByTestId("state-floor")).toHaveText(
      "Порог отката не установлен",
    );

    // Not a JSON artifact at all — refused ON THE FIELD, naming the rule, and
    // the submit never becomes available, so nothing leaves the browser.
    await page.getByTestId("import-artifact").fill("не json");
    await page.getByTestId("import-artifact").blur();
    await expect(page.getByTestId("import-artifact-error")).toContainText(
      "Это не JSON",
    );
    await expect(page.getByTestId("import-submit")).toBeDisabled();
    await expect(page.getByTestId("import-error")).toHaveCount(0);

    // A list naming a source the retained set does not contain. The server
    // answers VALIDATION_FAILED with the offending id, and the marker stays put.
    await submitArtifact(page, {
      reviewedRows: [
        { sourceId: ALIEN_SOURCE_ID, classification: "unmatched" },
      ],
    });
    const importError = page.getByTestId("import-error");
    await expect(importError).toContainText("VALIDATION_FAILED");
    await expect(importError).toContainText(
      "не покрывает сохранённые исходные строки",
    );
    await expect(importError).toContainText(ALIEN_SOURCE_ID);
    await expect(page.getByTestId("import-success")).toHaveCount(0);

    // No visible mutation: the marker, the counts and the queue are as they were.
    await page.reload();
    await expect(state.getByTestId("state-import")).toHaveText(
      "Артефакт не импортирован",
    );
    await expect(state.getByTestId("state-unresolved")).toHaveText(
      "Не разобрано: 0",
    );
    await expect(queueRows(page)).toHaveCount(0);

    // The surface never names, suggests or hints at a matching speaker.
    await expect(
      page.getByText(/предложенн|автоматическ.*совпад|похож/i),
    ).toHaveCount(0);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("012 EARS-24: the operator imports the reviewed artifact, resolves every retained row explicitly and closes the source", async ({
    page,
  }) => {
    test.skip(!ARTIFACT && !DATABASE_URL, ARTIFACT_REASON);
    await signInAsAdmin(page);
    await seedExpert(page);

    const rows = await reviewedRows(page);
    expect(rows.length).toBeGreaterThanOrEqual(3);

    await page.goto("/");
    await openQueue(page);

    // ---- artifact field: the declared rule REJECTS, then ACCEPTS ------------
    // The rule is `ImportSpeakerMigrationReviewsRequestSchema`: JSON whose
    // `reviewedRows` is a non-empty list of `{ sourceId, classification }`.
    // Malformed input is named as such locally; only a well-formed artifact is
    // allowed to reach the coverage proof on the server.
    await page.getByTestId("import-artifact").fill("{ reviewedRows: ");
    await page.getByTestId("import-artifact").blur();
    await expect(page.getByTestId("import-artifact-error")).toContainText(
      "Это не JSON",
    );
    await expect(page.getByTestId("import-submit")).toBeDisabled();
    await page.getByTestId("import-artifact").fill(JSON.stringify({ rows: 1 }));
    await page.getByTestId("import-artifact").blur();
    await expect(page.getByTestId("import-artifact-error")).toContainText(
      "reviewedRows",
    );
    await page
      .getByTestId("import-artifact")
      .fill(JSON.stringify({ reviewedRows: rows }));
    await page.getByTestId("import-artifact").blur();
    await expect(page.getByTestId("import-artifact-error")).toHaveCount(0);
    await expect(page.getByTestId("import-artifact-hint")).toBeVisible();
    await expect(page.getByTestId("import-submit")).toBeEnabled();

    // ---- import refusals against the REAL source set -----------------------
    // A row missing from the list: the artifact under-covers the source set.
    await submitArtifact(page, { reviewedRows: rows.slice(1) });
    await expect(page.getByTestId("import-error")).toContainText(
      rows[0]!.sourceId,
    );
    // A repeated source id: an ordered list, so the repeat is SEEN, not collapsed.
    await submitArtifact(page, { reviewedRows: [...rows, rows[0]!] });
    await expect(page.getByTestId("import-error")).toContainText(
      "VALIDATION_FAILED",
    );
    // An extra source id on top of a complete list.
    await submitArtifact(page, {
      reviewedRows: [
        ...rows,
        { sourceId: ALIEN_SOURCE_ID, classification: "unmatched" },
      ],
    });
    await expect(page.getByTestId("import-error")).toContainText(
      ALIEN_SOURCE_ID,
    );
    await expect(
      page.getByTestId("speaker-migration-state").getByTestId("state-import"),
    ).toHaveText("Артефакт не импортирован");

    // ---- import accepted ---------------------------------------------------
    await submitArtifact(page, { reviewedRows: rows });
    await expect(page.getByTestId("import-success")).toContainText(
      `Импортировано строк: ${rows.length}`,
    );
    const state = page.getByTestId("speaker-migration-state");
    await expect(state.getByTestId("state-import")).not.toHaveText(
      "Артефакт не импортирован",
    );
    await expect(state.getByTestId("state-unresolved")).toHaveText(
      `Не разобрано: ${rows.length}`,
    );
    // Importing twice is a conflict, not a second queue.
    await expect(page.getByTestId("speaker-migration-import")).toHaveCount(0);

    // ---- the queue ---------------------------------------------------------
    await expect(page.getByTestId("speaker-migration-filters")).toBeVisible();
    await expect(page.getByTestId("speaker-migration-table")).toBeVisible();
    await expect(page.getByTestId("speaker-migration-pagination")).toBeVisible();

    const first = queueRows(page).first();
    await expect(first.getByTestId("source-name")).not.toBeEmpty();
    await expect(first.getByTestId("source-event-id")).not.toBeEmpty();
    await expect(first.getByTestId("source-position")).not.toBeEmpty();
    await expect(first.getByTestId("source-fingerprint")).not.toBeEmpty();
    await expect(first.getByTestId("source-classification")).toHaveText(
      /^(Без совпадения|Неоднозначно|Дубликат)$/,
    );
    await expect(first.getByTestId("source-disposition")).toHaveText(
      "Не разобрано",
    );
    // Provenance is read-only — nothing in the row is editable.
    await expect(first.locator("input, textarea")).toHaveCount(0);

    // Closure is refused while the release is unrecorded — and the refusal is
    // the PRECONDITION, surfaced verbatim, not a generic failure.
    await page.getByTestId("speaker-migration-close").click();
    await page.getByTestId("speaker-migration-close-confirm").click();
    const closeError = page.getByTestId("speaker-migration-close-error");
    await expect(closeError).toContainText("PRECONDITION_REQUIRED");

    // ---- resolution 1: an existing Expert ----------------------------------
    await first.getByTestId("speaker-migration-resolve").click();
    await page.getByTestId("resolution-existing-expert").click();
    // The Expert selector is a closed, server-paginated Combobox: the operator
    // searches and picks, and no name from the source row is ever prefilled.
    const expertTrigger = page.locator("#resolution-expert-combobox");
    await expect(expertTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(expertTrigger).not.toContainText(
      (await first.getByTestId("source-name").innerText()).trim(),
    );
    await expertTrigger.click();
    const panelId = await expertTrigger.getAttribute("aria-controls");
    const option = page.locator(`[id="${panelId}"]`).getByRole("option").first();
    await expect(option).toBeVisible();
    await option.click();
    await page.getByTestId("resolution-role").fill("Докладчик");
    await page.getByTestId("resolution-position").fill("0");

    // A retained duplicate pair is the one refusal EARS-24 names on a
    // resolution, and it reaches the operator verbatim.
    const conflictRoute = async (route: import("@playwright/test").Route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          errorCode: "RELATIONSHIP_CONFLICT",
          detail: "the migration review already has a different terminal resolution",
          traceId: "ears-24-ui-conflict",
        }),
      });
    };
    await page.route("**/speaker-migration-reviews/*/resolve", conflictRoute);
    await page.getByTestId("resolution-submit").click();
    await expect(page.getByTestId("resolution-error")).toContainText(
      "RELATIONSHIP_CONFLICT",
    );
    await page.unroute("**/speaker-migration-reviews/*/resolve", conflictRoute);

    const existingRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/resolve"),
    );
    await page.getByTestId("resolution-submit").click();
    expect((await existingRequest).postDataJSON()).toMatchObject({
      disposition: "existing_expert",
      role: "Докладчик",
      position: 0,
    });
    await expect(page.getByTestId("resolution-dialog")).toHaveCount(0);

    // Resolved rows leave the default view — the queue shows what still needs work.
    await expect(state.getByTestId("state-unresolved")).toHaveText(
      `Не разобрано: ${rows.length - 1}`,
    );
    await expect(queueRows(page)).toHaveCount(rows.length - 1);

    // …and come back, read-only, when the operator asks for them.
    await showResolvedRows(page);
    await expect(queueRows(page).first().getByTestId("source-disposition")).toHaveText(
      "Связано с экспертом",
    );
    await expect(
      queueRows(page)
        .first()
        .getByTestId("speaker-migration-resolve"),
    ).toHaveCount(0);
    // An already resolved source is immutable — the console says so verbatim.
    await resetAllFilters(page).click();
    await expect(page.getByTestId("filters-show-resolved")).not.toBeChecked();

    // ---- resolution 2: a newly created Expert ------------------------------
    const second = queueRows(page).first();
    await second.getByTestId("speaker-migration-resolve").click();
    await page.getByTestId("resolution-created-expert").click();
    await page.getByTestId("resolution-submit").click();
    await expect(page.getByTestId("resolution-error")).toContainText(
      "Проверьте обязательные поля",
    );
    const familyName = `Миграционный-${Date.now()}`;
    await page.getByTestId("resolution-family-name").fill(familyName);
    await page.getByTestId("resolution-given-name").fill("Эксперт");
    await page.getByTestId("resolution-patronymic").fill("Тестович");
    await page.getByTestId("resolution-professional-role").fill("Кардиолог");
    await page.getByTestId("resolution-role").fill("Модератор");
    await page.getByTestId("resolution-position").fill("1");
    const createdRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/resolve"),
    );
    await page.getByTestId("resolution-submit").click();
    expect((await createdRequest).postDataJSON()).toEqual({
      disposition: "created_expert",
      expert: {
        familyName,
        givenName: "Эксперт",
        patronymic: "Тестович",
        professionalRole: "Кардиолог",
      },
      role: "Модератор",
      position: 1,
    });
    await expect(state.getByTestId("state-unresolved")).toHaveText(
      `Не разобрано: ${rows.length - 2}`,
    );

    // ---- narrow viewport: the queue reads as cards, and the page never pans --
    await page.setViewportSize(NARROW);
    await expect(queueRows(page).first()).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- the remaining rows: content removed --------------------------------
    while (await queueRows(page).count()) {
      await queueRows(page).first().getByTestId("speaker-migration-resolve").click();
      await page.getByTestId("resolution-content-removed").click();
      await page.getByTestId("resolution-submit").click();
      await expect(page.getByTestId("resolution-dialog")).toHaveCount(0);
    }
    await expect(state.getByTestId("state-unresolved")).toHaveText(
      "Не разобрано: 0",
    );

    // ---- release fields: the declared rules REJECT, then ACCEPT -------------
    // Both rules are the API's own (`RecordPhaseAwareReleaseRequestSchema`):
    // SHA `^[0-9a-f]{40}$`, ordinal integer ≥ 1. The console declares them
    // client-side, so a typo is refused here in RU naming the rule and the
    // submit stays disabled — the operator never spends a round trip, and the
    // one value that gates a rollback is never sent half-typed.
    const releaseSubmit = page.getByTestId("release-submit");
    await page.getByTestId("release-sha").fill("не sha");
    await page.getByTestId("release-sha").blur();
    await page.getByTestId("release-ordinal").fill("0");
    await page.getByTestId("release-ordinal").blur();
    await expect(page.getByTestId("release-sha-error")).toContainText(
      "40 символов",
    );
    await expect(page.getByTestId("release-ordinal-error")).toContainText(
      "целое число от 1",
    );
    await expect(page.getByTestId("release-sha-hint")).toHaveCount(0);
    await expect(releaseSubmit).toBeDisabled();

    const sha = "a".repeat(40);
    await page.getByTestId("release-sha").fill(sha);
    await page.getByTestId("release-sha").blur();
    await page.getByTestId("release-ordinal").fill("7");
    await page.getByTestId("release-ordinal").blur();
    await expect(page.getByTestId("release-sha-error")).toHaveCount(0);
    await expect(page.getByTestId("release-ordinal-error")).toHaveCount(0);
    await expect(page.getByTestId("release-sha-hint")).toBeVisible();
    await expect(releaseSubmit).toBeEnabled();
    await releaseSubmit.click();
    await expect(page.getByTestId("release-success")).toBeVisible();
    await expect(state.getByTestId("state-release")).toContainText(sha.slice(0, 12));

    await page.getByTestId("speaker-migration-close").click();
    const closeRequest = page.waitForRequest((request) =>
      request.url().endsWith("/speaker-migration-reviews/close-source"),
    );
    await page.getByTestId("speaker-migration-close-confirm").click();
    expect((await closeRequest).postData()).toBeNull();
    await expect(page.getByTestId("speaker-migration-close-success")).toBeVisible();

    // ---- after closure the console is read-only ----------------------------
    await page.reload();
    await expect(state.getByTestId("state-phase")).toHaveText("Источник закрыт");
    await expect(state.getByTestId("state-floor")).toContainText(sha.slice(0, 12));
    await expect(page.getByTestId("speaker-migration-closed-note")).toBeVisible();
    await expect(page.getByTestId("speaker-migration-import")).toHaveCount(0);
    await expect(page.getByTestId("speaker-migration-release")).toHaveCount(0);
    await expect(page.getByTestId("speaker-migration-close")).toHaveCount(0);
    await showResolvedRows(page);
    await expect(page.getByTestId("speaker-migration-resolve")).toHaveCount(0);
  });
});
