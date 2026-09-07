/**
 * One-off UI-evidence capture for #1967 (028 EARS-1,3,4,5,6 — the doctor
 * storefront «Документы и контакты» surface). Not a test — a screenshot driver
 * for the PR's `ui-render-*` / `ui-interactions` markers, run by hand against a
 * live doctor stand. Kept out of `e2e/*.spec.ts` so Playwright never picks it up.
 *
 *   E2E_DOCTOR_URL=http://localhost:3404 node e2e/ui-evidence-1967.mjs <outDir>
 *
 * It also drives 028 V-3 (index → document → back → «Другие документы») and the
 * affordance checks, printing ONE compact verdict line per check so the driving
 * agent never has to open a browser snapshot.
 */

/* global localStorage, document, getComputedStyle */
// The identifiers above are referenced only inside `page.evaluate` callbacks,
// which run in the BROWSER, not in this Node process — the same declaration the
// portal twin `apps/portal/e2e/ui-evidence-1934.mjs` carries.

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";

// `localhost`, not `127.0.0.1`: Next refuses the asset requests of an unlisted
// origin, the page never hydrates, and every "interaction" shot silently comes
// back in the initial state.
const BASE = process.env.E2E_DOCTOR_URL ?? "http://localhost:3404";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};

// The doctor theme is CLASS-based (`apps/doctor/lib/theme.ts`): `<html class="dark">`
// keyed off `localStorage["ds-theme"]`. A Playwright `colorScheme` is a no-op
// here, so the choice is seeded BEFORE navigation — the app's own init script
// then applies it, exactly as a returning visitor would see it — and stamped
// again after load as a guard against byte-identical shots.
const THEME_STORAGE_KEY = "ds-theme";

const results = [];
function verdict(ok, line) {
  results.push({ ok, line });
  console.log((ok ? "PASS " : "FAIL ") + line);
}

async function openContext(browser, viewport, theme) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[viewport] });
  await ctx.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private mode — the class stamp below still applies */
      }
    },
    [THEME_STORAGE_KEY, theme],
  );
  return ctx;
}

async function shoot(browser, { name, viewport, theme, path = "/documents", after }) {
  const ctx = await openContext(browser, viewport, theme);
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page
    .locator("html")
    .evaluate((html, isDark) => html.classList.toggle("dark", isDark), theme === "dark");
  if (after) {
    await page.waitForTimeout(500);
    await after(page);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: OUT + "/" + name + ".png", fullPage: !after });
  await ctx.close();
  console.log("captured " + name + ".png");
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- render shots
for (const viewport of ["desktop", "mobile"]) {
  for (const theme of ["light", "dark"]) {
    await shoot(browser, { name: viewport + "-" + theme, viewport, theme });
  }
}

// Light !== dark by byte size — the class-based theme silently no-ops when the
// stamp misses, and four identical files would be worthless evidence.
for (const viewport of ["desktop", "mobile"]) {
  const light = statSync(OUT + "/" + viewport + "-light.png").size;
  const dark = statSync(OUT + "/" + viewport + "-dark.png").size;
  verdict(light !== dark, viewport + ": light (" + light + "B) !== dark (" + dark + "B)");
}

// ---------------------------------------------------------------- interactions
await shoot(browser, {
  name: "interactions-document-desktop",
  viewport: "desktop",
  theme: "light",
  path: "/documents/privacy-policy",
});

await shoot(browser, {
  name: "interactions-toc-mobile-open",
  viewport: "mobile",
  theme: "light",
  path: "/documents/privacy-policy",
  after: async (page) => {
    await page.locator("details summary").first().click();
  },
});

await shoot(browser, {
  name: "interactions-not-found",
  viewport: "desktop",
  theme: "light",
  path: "/documents/no-such-doc",
});

await shoot(browser, {
  name: "interactions-footer-entry",
  viewport: "desktop",
  theme: "light",
  after: async (page) => {
    const link = page
      .locator("footer")
      .getByRole("link", { name: "Документы и контакты", exact: true })
      .first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
  },
});

// ------------------------------------------------------------------- V-3 drive
{
  const ctx = await openContext(browser, "desktop", "light");
  const page = await ctx.newPage();

  const indexResponse = await page.goto(BASE + "/documents", { waitUntil: "networkidle" });
  verdict(indexResponse?.status() === 200, "V-3 index /documents -> " + indexResponse?.status());

  const rowLink = page
    .getByRole("link", { name: /Политика персональных данных и согласия/ })
    .first();
  verdict(await rowLink.isVisible(), "V-3 index shows the policy row");

  const rowCount = await page.locator('a[href^="/documents/"]').count();
  verdict(rowCount > 0, "V-3 index list renders (" + rowCount + " document links)");

  await rowLink.click();
  await page.waitForURL(/\/documents\/privacy-policy$/);
  verdict(true, "V-3 index -> /documents/privacy-policy");

  const back = page.getByRole("link", { name: /Документы/ }).first();
  await back.click();
  await page.waitForURL(/\/documents$/);
  verdict(true, "V-3 back link returns to /documents");

  await page.goto(BASE + "/documents/privacy-policy", { waitUntil: "networkidle" });
  const others = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/documents/"]')).map((a) =>
      a.getAttribute("href"),
    ),
  );
  for (const href of [...new Set(others)]) {
    const res = await page.request.get(BASE + href);
    verdict(res.status() === 200, "V-3 «Другие документы» link " + href + " -> " + res.status());
  }

  // Affordances: pointer cursor + hover style delta + focus ring, ONE verdict per
  // element CLASS (not per node, and not as a screenshot).
  for (const [label, selector] of [
    ["documents row link", 'a[href="/documents/privacy-policy"]'],
    ["academy caption link", '[data-testid="documents-academy-caption"]'],
    ["support mailto chip", '[data-testid="documents-support"] a'],
    ["community chip", '[data-testid="documents-channels"] a'],
    ["footer entry link", 'footer a[href="/documents"]'],
  ]) {
    await page.goto(BASE + "/documents", { waitUntil: "networkidle" });
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) {
      verdict(false, "affordance " + label + ": element not found (" + selector + ")");
      continue;
    }
    const read = () =>
      el.evaluate((n) => {
        const s = getComputedStyle(n);
        // boxShadow and transform belong in the delta: the list ROW is a card
        // whose hover is `shadow-md -> shadow-sm`, not a colour change, and
        // reading only ink would report a real affordance as missing.
        return [
          s.color,
          s.textDecorationLine,
          s.backgroundColor,
          s.borderColor,
          s.opacity,
          s.boxShadow,
          s.transform,
        ].join("|");
      });
    const cursor = await el.evaluate((n) => getComputedStyle(n).cursor);
    const before = await read();
    await el.scrollIntoViewIfNeeded();
    await el.hover();
    await page.waitForTimeout(200);
    const after = await read();
    await el.focus();
    await page.waitForTimeout(120);
    const ring = await el.evaluate((n) => {
      const s = getComputedStyle(n);
      return s.outlineStyle + ":" + s.outlineWidth + "|" + s.boxShadow;
    });
    const hasRing = ring !== "none:0px|none";
    verdict(
      cursor === "pointer" && before !== after && hasRing,
      "affordance " + label + ": cursor=" + cursor + " hover-delta=" + (before !== after) + " focus=" + ring,
    );
  }

  // ------------------------------------------------------ copy self-consistency
  await page.goto(BASE + "/documents", { waitUntil: "networkidle" });
  const copy = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim(),
    row: document.querySelector('a[href="/documents/privacy-policy"]')?.textContent?.trim(),
    caption: document.querySelector('[data-testid="documents-academy-caption"]')?.textContent?.trim(),
    mail: document.querySelector('[data-testid="documents-support"] a')?.getAttribute("href"),
    mailCaption: document
      .querySelector('[data-testid="documents-support"] p:last-of-type')
      ?.textContent?.trim(),
    channels: Array.from(document.querySelectorAll('[data-testid^="documents-channel-"]')).map(
      (a) => a.textContent?.trim() + "=" + a.getAttribute("href"),
    ),
    requisites: document.querySelector('[data-testid="documents-requisites"]')?.textContent?.trim(),
  }));

  const EXPECTED = {
    h1: "Документы и контакты",
    row: "Политика персональных данных и согласия",
    caption: "Полный набор документов платформы — на странице документов Академии.",
    mail: "mailto:support@doctor.school",
    mailCaption: "Мы отвечаем в рабочие дни.",
    channels: ["Telegram=https://t.me/doctorschool"],
    requisites:
      "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703",
  };

  const mismatches = [];
  for (const [key, want] of Object.entries(EXPECTED)) {
    const got = copy[key];
    const ok = Array.isArray(want)
      ? JSON.stringify(want) === JSON.stringify(got)
      : typeof got === "string" && got.includes(want);
    if (!ok) mismatches.push(key + ": want " + JSON.stringify(want) + " got " + JSON.stringify(got));
  }
  verdict(
    mismatches.length === 0,
    mismatches.length === 0
      ? "copy self-consistency: all 7 rendered strings match apps/doctor/lib/contacts.ts + the page constants"
      : "copy self-consistency: " + mismatches.join(" ;; "),
  );

  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log("\n=== " + (results.length - failed.length) + "/" + results.length + " checks passed ===");
for (const f of failed) console.log("FAILED: " + f.line);
if (failed.length > 0) process.exitCode = 1;
