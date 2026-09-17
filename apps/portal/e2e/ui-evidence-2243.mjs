/**
 * One-off UI-evidence capture for #2243 (008 EARS-5/11 — the Academy signed-in
 * auth cluster carries «Мои события» → `/account/events` again). Not a test — a
 * screenshot driver for the PR's `ui-render-*` markers, kept out of
 * `e2e/*.spec.ts` so Playwright never collects it. Mirrors
 * `apps/portal/e2e/ui-evidence-2015.mjs`; the DRIVEN proof is
 * `e2e/shell/doctor-header.spec.ts` (EARS-5 / EARS-11), not these frames.
 *
 * The cluster only exists for a signed-in doctor, so the script provisions one
 * the way 003 mints it — the real `/register` → Mailpit OTP → auto-login flow,
 * no auth primitive invented here — and gives them a display name so the chip
 * renders genuine initials.
 *
 * Boot the PRODUCTION standalone build of the branch head, from the worktree root
 * (the portal builds with `output: "standalone"`; `next start` silently 404s):
 *
 *   NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY='' API_PROXY_TARGET=http://localhost:3100 \
 *     pnpm --filter "@ds/api..." --filter "@ds/portal..." build
 *   cp -r apps/portal/.next/static apps/portal/.next/standalone/apps/portal/.next/
 *   cp -r apps/portal/public       apps/portal/.next/standalone/apps/portal/
 *   (api on :3100 with the branch DATABASE_URL and BOT_PROTECTION_ENABLED=false;
 *    portal: cd apps/portal/.next/standalone && PORT=3101 HOSTNAME=0.0.0.0 \
 *      API_PROXY_TARGET=http://localhost:3100 node apps/portal/server.js)
 *
 *   E2E_PORTAL_URL=http://localhost:3101 MAILPIT_URL=http://truenas.local:8025 \
 *     node apps/portal/e2e/ui-evidence-2243.mjs .github/ui-evidence/2243/academy
 *
 * `localhost`, never `127.0.0.1`: Next answers 403 to an unlisted origin and the
 * page never hydrates.
 */

/* global localStorage, document */

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const PORTAL = process.env.E2E_PORTAL_URL ?? "http://localhost:3101";
const MAILPIT = (process.env.MAILPIT_URL ?? "http://truenas.local:8025").replace(
  /\/$/,
  "",
);
const OUT = process.argv[2] ?? ".github/ui-evidence/2243/academy";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
// The portal theme is CLASS-based (`apps/portal/lib/theme.ts`): the `ds-theme`
// localStorage choice wins and the inline init script writes `.dark` on <html>
// before first paint, so the OS-level `colorScheme` alone is not authoritative.
const THEME_STORAGE_KEY = "ds-theme";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The verify-email code, subject-first exactly as `e2e/support/mailpit.ts` reads it. */
async function fetchOtpCode(email) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages = [] } = await search.json();
    if (messages.length > 0) {
      const detail = await (
        await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)
      ).json();
      const code =
        (detail.Subject ?? "").match(/^([A-Z0-9]{4,12})\s+—/)?.[1] ??
        `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.match(
          /\b([A-Z0-9]{6,8})\b/,
        )?.[1];
      if (code) return code;
    }
    await sleep(500);
  }
  throw new Error(`ui-evidence: no verify-email OTP reached Mailpit for ${email}`);
}

/** Mint a signed-in doctor with a saved display name («ВК»), the 003 way. */
async function signIn(page) {
  const email = `e2e-2243-${Date.now()}@ds.test`;
  await page.goto(`${PORTAL}/register`, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="email"]').fill(email);
  await page
    .locator('input[autocomplete="new-password"]')
    .fill(`Prt-${Date.now()}-aA1!`);
  await page.getByTestId("register-submit").click();
  await page.waitForURL(/\/verify/);
  const code = await fetchOtpCode(email);
  // The InputOTP `onComplete` auto-submits and auto-logs-in (#175).
  await page.locator('input[autocomplete="one-time-code"]').fill(code);
  await page.waitForURL((url) => !/\/(register|verify)/.test(new URL(url).pathname));
  const saved = await page.evaluate(async () => {
    const response = await fetch("/v1/me/display-name", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ displayName: "Виктор Ковалёв" }),
    });
    return response.ok;
  });
  if (!saved) throw new Error("ui-evidence: could not save the display name");
}

async function assertTheme(page, name, theme) {
  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (dark !== (theme === "dark")) {
    throw new Error(`${name}: expected ${theme}, got ${dark ? "dark" : "light"}`);
  }
}

async function shoot(browser, { viewport, theme }) {
  const name = `${viewport}-${theme}`;
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    colorScheme: theme,
  });
  await ctx.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        throw new Error("ui-evidence: cannot seed the persisted theme choice");
      }
    },
    [THEME_STORAGE_KEY, theme],
  );
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`${PORTAL}/webinars`, { waitUntil: "networkidle" });
  await page.getByTestId("shell-avatar").waitFor();
  await assertTheme(page, name, theme);

  let clipHeight = 200;
  if (viewport === "mobile") {
    // Open the `≡` disclosure — the row the canvas draws at line 50.
    await page.getByTestId("shell-mobile-menu").locator("summary").click();
    await page.getByTestId("shell-auth-link-mobile").waitFor();
    clipHeight = 340;
  } else {
    await page.getByTestId("shell-auth-link").waitFor();
  }

  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: { x: 0, y: 0, width: VIEWPORTS[viewport].width, height: clipHeight },
  });
  console.log(`captured ${name}.png`);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const viewport of ["desktop", "mobile"]) {
    for (const theme of ["light", "dark"]) {
      await shoot(browser, { viewport, theme });
    }
  }
} finally {
  await browser.close();
}
