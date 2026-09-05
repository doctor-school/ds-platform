/**
 * One-off UI-evidence capture for #1607 (012 EARS-24) — the provenance-safe
 * speaker-migration review console. Not a test: a screenshot driver for the PR's
 * `ui-render-*` / `ui-interactions` markers, run by hand against a live
 * admin + api pair on a FRESH branch database. Modelled on
 * `apps/portal/e2e/ui-evidence-1345.mjs`, kept out of `e2e/*.spec.ts` so
 * Playwright never picks it up as a spec.
 *
 * It reproduces the operator's real arc rather than faking a state:
 *   1. sign in as a provisioned `platform_admin` (the shared `signInAsAdmin`);
 *   2. seed legacy source rows through the event form's free-text speaker list
 *      (LD-1), the same pre-cutover write path the flow spec uses;
 *   3. read `event_speakers.id` back READ-ONLY — the offline DBA export the
 *      owner classifies by hand (012-design §2.3), since no wire contract
 *      exposes those ids on purpose;
 *   4. drive the import REFUSAL (an artifact naming a source that is not in the
 *      retained set), then the accepted import, then the resolution dialog.
 *
 * Because the helpers it reuses are TypeScript, run it through `tsx`:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 DATABASE_URL=… IDP_ISSUER=… \
 *   IDP_SERVICE_TOKEN=… IDP_PROJECT_ID=… \
 *   npx tsx apps/admin/e2e/ui-evidence-1607.mjs .github/ui-evidence/1607
 *
 * The import is one-shot per database (closure/import state is a singleton
 * cutover row), so re-run it against a fresh `pnpm dev:db:branch 1607`.
 */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { Client } from "pg";
import { signInAsAdmin, ADMIN_ORIGIN } from "./support/sign-in.ts";
import { visible } from "./support/visible.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required — the reviewed artifact is exported from the database under test (012-design §2.3)",
  );

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: ui-evidence-1607.mjs <output-directory>");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1100 },
  mobile: { width: 390, height: 900 },
};

/** The three classifications, cycled so the queue facets have something to show. */
const CLASSIFICATIONS = ["unmatched", "ambiguous", "duplicate"];

/** A syntactically valid UUID that names no retained source row. */
const ALIEN_SOURCE_ID = "00000000-0000-4000-8000-0000000012ff";

/**
 * Seed legacy source rows the way an operator does before the cutover. The last
 * two share a name on purpose: retained duplicates must survive into the queue.
 */
async function seedLegacySpeakers(page) {
  const stamp = Date.now();
  const names = [
    `Мигрируемый Первый ${stamp}`,
    `Мигрируемый Второй ${stamp}`,
    `Мигрируемый Дубль ${stamp}`,
    `Мигрируемый Дубль ${stamp}`,
  ];
  await page.goto("/events/create");
  await page.getByTestId("event-form").waitFor();
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

/** The DBA export: every retained source row, in the server's stable id order. */
async function exportRetainedSourceIds() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query("SELECT id FROM event_speakers ORDER BY id");
    return result.rows.map((row) => row.id);
  } finally {
    await client.end();
  }
}

async function submitArtifact(page, body) {
  await page.getByTestId("import-artifact").fill(JSON.stringify(body));
  await page.getByTestId("import-submit").click();
}

/**
 * The dark palette is CLASS-driven (`.dark` on an ancestor, `tokens.css`), not
 * `prefers-color-scheme` — and the admin surface ships no theme switcher, so the
 * only way to render the dark tokens is to set the class the way the host app
 * does. `colorScheme` is still passed on the context so the UA form controls
 * match. Applied before any script runs, so nothing paints in light first.
 */
async function useDarkTokens(context) {
  // The callback is serialised and evaluated in the BROWSER realm, so its
  // globals are reached through `globalThis` — this file itself is linted as
  // Node source and has no `document` in scope.
  await context.addInitScript(() => {
    const apply = () =>
      globalThis.document?.documentElement?.classList.add("dark");
    apply();
    globalThis.document?.addEventListener("DOMContentLoaded", apply);
  });
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`captured ${name}.png`);
}

const browser = await chromium.launch();

// --- one real sign-in, reused by every shot -------------------------------
const authCtx = await browser.newContext({
  viewport: VIEWPORTS.desktop,
  baseURL: ADMIN_ORIGIN,
  locale: "ru-RU",
});
const authPage = await authCtx.newPage();
await signInAsAdmin(authPage);

// --- the operator's arc, driven once on the seeded database ---------------
await seedLegacySpeakers(authPage);
const sourceIds = await exportRetainedSourceIds();
const reviewedRows = sourceIds.map((sourceId, i) => ({
  sourceId,
  classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length],
}));
console.log(`seeded ${reviewedRows.length} retained source rows`);

await authPage.getByTestId("nav-speaker-migration").click();
await authPage.waitForURL(/\/speaker-migration$/);
await authPage.getByTestId("speaker-migration-state").waitFor();

// `import-refused`: a list naming a source outside the retained set is rejected
// and nothing mutates — the refusal the import must never fail to make.
await submitArtifact(authPage, {
  reviewedRows: [{ sourceId: ALIEN_SOURCE_ID, classification: "unmatched" }],
});
await authPage.getByTestId("import-error").waitFor();
await shoot(authPage, "interactions-import-refused");

// The accepted import — the queue the four render shots are taken against.
await submitArtifact(authPage, { reviewedRows });
await authPage.getByTestId("import-success").waitFor();
await authPage
  .getByTestId(`speaker-migration-row-${reviewedRows[0].sourceId}`)
  .first()
  .waitFor();

const storageState = await authCtx.storageState();
await authCtx.close();

// --- `queue-review-open` across the responsive-web matrix -----------------
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: VIEWPORTS[viewport],
      colorScheme: theme,
      baseURL: ADMIN_ORIGIN,
      locale: "ru-RU",
      storageState,
    });
    if (theme === "dark") await useDarkTokens(ctx);
    const page = await ctx.newPage();
    await page.goto("/speaker-migration", { waitUntil: "networkidle" });
    await page.getByTestId("speaker-migration-table").waitFor();
    // `DataTable` renders every record twice — a desktop table and a mobile card
    // list, one hidden per breakpoint — so only the VISIBLE copy means "the row
    // the operator sees at this width".
    await visible(
      page.getByTestId(`speaker-migration-row-${reviewedRows[0].sourceId}`),
    ).waitFor();
    await shoot(page, `${viewport}-${theme}`);
    await ctx.close();
  }
}

// --- `resolution-dialog`: the operator's per-row decision surface ----------
const dialogCtx = await browser.newContext({
  viewport: VIEWPORTS.desktop,
  colorScheme: "light",
  baseURL: ADMIN_ORIGIN,
  locale: "ru-RU",
  storageState,
});
const dialogPage = await dialogCtx.newPage();
await dialogPage.goto("/speaker-migration", { waitUntil: "networkidle" });
await visible(dialogPage.getByTestId("speaker-migration-resolve")).first().click();
await dialogPage.getByTestId("resolution-dialog").waitFor();
await shoot(dialogPage, "interactions-resolution-dialog");
await dialogCtx.close();

await browser.close();
