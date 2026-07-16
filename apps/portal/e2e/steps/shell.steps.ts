import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import {
  provisionDoctorCreds,
  provisionLoggedInDoctor,
} from "../support/doctor-session";
import {
  DISCOVERY_HEADING,
  desktopThemeToggle,
  setMyDisplayName,
  shellHeader,
} from "../support/shell";

/**
 * 008 shell-journey step definitions — the browser translation of the connected
 * shell arc (login → discovery front-door `/` → shell nav → profile; guest «Войти»
 * + the same `/`; mobile ≡ collapse). Driven on the live dev stand; the shared
 * Background step («the live dev stand is available», registration.steps.ts) gates
 * the whole feature on `LIVE_STAND` and is intentionally reused, not redefined.
 *
 * Every step title here is DISTINCT from the 004/005/006 journey steps —
 * playwright-bdd merges all step files into one registry, so a duplicated title is
 * an ambiguous-step error.
 */

const DOCTOR_NAME = "Иван Петров";
const DOCTOR_INITIALS = "ИП";

// ── Doctor logs in → lands on `/` → shell nav → profile (EARS-1/2/6/7) ────────

Given("a registered doctor who is not yet signed in", async ({ page, context, world }) => {
  // Mint a real 003 account with KNOWN credentials + a saved display name (so the
  // avatar renders genuine initials), then drop the register auto-login session so
  // the next step drives a deliberate `/login` — the true post-login landing.
  const creds = await provisionDoctorCreds(page);
  world.email = creds.email;
  world.password = creds.password;
  await setMyDisplayName(page, DOCTOR_NAME);
  await context.clearCookies();
});

When("the doctor completes login via the feature-003 auth flow", async ({ page, world }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /почта|email/i }).fill(world.email!);
  await page.getByRole("textbox", { name: /пароль|password/i }).fill(world.password!);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();
});

Then("the doctor lands on the discovery front-door at {string}", async ({ page }, path: string) => {
  // EARS-7: the post-login landing is the discovery front-door — exactly `/`.
  await page.waitForURL((url) => new URL(url).pathname === path);
  await expect(
    page.getByRole("heading", { name: DISCOVERY_HEADING }),
  ).toBeVisible();
});

Then(
  "the persistent header shows the logo, the top-nav, a theme toggle, and the doctor's avatar icon",
  async ({ page }) => {
    // #1004: the login flow fires `refreshHeaderAuth()` before its soft
    // `router.push`, so the persistent header re-reads the session and shows the
    // avatar on THIS soft post-login landing — no hard reload. EARS-7 (the `/`
    // discovery landing) is already asserted; the avatar assertion below
    // auto-waits for the signaled re-read to resolve.
    const header = shellHeader(page);
    await expect(header.getByTestId("shell-logo")).toBeVisible();
    await expect(page.getByTestId("shell-nav-broadcasts")).toBeVisible();
    await expect(page.getByTestId("shell-nav-my-events")).toBeVisible();
    await expect(desktopThemeToggle(page)).toBeVisible();
    // EARS-5/6: the avatar is an icon showing the doctor's real initials.
    await expect(page.getByTestId("shell-avatar")).toHaveText(DOCTOR_INITIALS);
  },
);

When("the doctor activates «Мои события» in the header nav", async ({ page }) => {
  await page.getByTestId("shell-nav-my-events").click();
});

Then("the shell navigates to {string}", async ({ page }, path: string) => {
  await expect(page).toHaveURL(new RegExp(`${escapeRe(path)}$`));
});

When("the doctor activates the header avatar icon", async ({ page }) => {
  await page.getByTestId("shell-avatar").click();
});

Then("the shell navigates to the profile {string}", async ({ page }, path: string) => {
  await expect(page).toHaveURL(new RegExp(`${escapeRe(path)}$`));
});

// ── Guest sees «Войти» and the same `/` (EARS-4/8) ────────────────────────────

Given("a visitor with no authenticated session", async ({ context }) => {
  await context.clearCookies();
});

When("the visitor opens the discovery front-door", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

Then("the discovery listing of upcoming broadcasts is shown", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: DISCOVERY_HEADING }),
  ).toBeVisible();
});

Then(
  "the header shows a «Войти» button and no avatar and no «Выйти»",
  async ({ page }) => {
    await expect(page.getByTestId("shell-login")).toBeVisible();
    await expect(page.getByTestId("shell-avatar")).toHaveCount(0);
    await expect(shellHeader(page).getByText(/выйти/i)).toHaveCount(0);
  },
);

When("the visitor activates «Войти»", async ({ page }) => {
  await page.getByTestId("shell-login").click();
});

Then("the shell navigates to the login surface", async ({ page }) => {
  await expect(page).toHaveURL(/\/login(?:$|[?#])/);
});

// ── Mobile ≡ collapse (EARS-11/2) ─────────────────────────────────────────────

Given("a doctor on the discovery front-door at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  // A fresh 003 doctor (lands on /account), then a hard load of `/` so the header
  // reads the session and renders the doctor branch at the mobile breakpoint.
  await provisionLoggedInDoctor(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
});

When("the doctor opens the header ≡ navigation", async ({ page }) => {
  // The desktop nav is collapsed at ≤900px; the ≡ disclosure takes its place.
  await expect(page.getByTestId("shell-nav-desktop")).toBeHidden();
  await shellHeader(page).getByTestId("shell-mobile-menu").locator("summary").click();
});

Then("the ≡ dropdown carries the items [Эфиры · Мои события]", async ({ page }) => {
  const broadcasts = page.getByTestId("shell-mobile-broadcasts");
  const myEvents = page.getByTestId("shell-mobile-my-events");
  await expect(broadcasts).toBeVisible();
  await expect(myEvents).toBeVisible();
  await expect(broadcasts).toHaveAttribute("href", "/");
  await expect(myEvents).toHaveAttribute("href", "/account/events");
});

Then(
  "selecting «Мои события» in the ≡ dropdown navigates to {string}",
  async ({ page }, path: string) => {
    // A logged-in doctor, so the authenticated target resolves in place (no auth
    // redirect) — EARS-11 preserves every target's resolution (EARS-2).
    await page.getByTestId("shell-mobile-my-events").click();
    await expect(page).toHaveURL(new RegExp(`${escapeRe(path)}$`));
  },
);

/** Regex-escape a literal pathname for a `toHaveURL` suffix match. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
