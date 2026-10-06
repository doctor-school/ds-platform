import { test, expect, request as playwrightRequest } from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";
import { mailedCode } from "./support/congress-stand";

/**
 * 003 EARS-44 · 044 EARS-39 — the Congress hand-off, live on the doctor host.
 *
 * A real Congress sign-up (`POST /v1/congress/sign-up`, through this host's own
 * `/v1` proxy) mints the reference; `/login?method=code&handoff=<ref>` redeems
 * it into the code send and opens straight on the code step; the mailed code
 * signs in and lands on the carried `returnTo`. A dead reference falls back to
 * the EARS-43 state with nothing sent.
 *
 * Stand prerequisite (operator-owned, like every live tier): the api runs with
 * the `CONGRESS_SIGNUP_*` keys configured and its `CONGRESS_SIGNUP_EVENT_ID`
 * names an event that exists in its database — the sign-up is the ONLY minter
 * of a reference, so there is no shorter honest setup. Rides
 * `playwright.congress.config.ts`; inert on a bare CI runner.
 */
requireLiveStandEnv(["E2E_DOCTOR_URL", "MAILPIT_URL", "IDP_ISSUER"]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");

/** A fresh Congress sign-up; answers the hand-off reference it returned. */
async function signUpForCongress(email: string): Promise<string> {
  const api = await playwrightRequest.newContext({ baseURL: DOCTOR_URL });
  try {
    const book = await api.get("/v1/public/specialties");
    expect(book.ok(), `specialties — ${book.status()}`).toBe(true);
    const { entries } = (await book.json()) as {
      entries: Array<{ id: string }>;
    };
    const res = await api.post("/v1/congress/sign-up", {
      data: {
        surname: "Иванова",
        firstName: "Мария",
        patronymic: "Петровна",
        email,
        specialtyId: entries[0]!.id,
        workplace: "ГКБ № 1",
        city: "Москва",
        region: "Москва",
        contactPhone: "+7 (900) 123-45-67",
        personalDataConsent: true,
      },
    });
    const body = (await res.json()) as { status?: string; handoff?: string };
    expect(
      body.status,
      `congress sign-up — ${res.status()}: ${JSON.stringify(body)}`,
    ).toBe("accepted");
    return body.handoff!;
  } finally {
    await api.dispose();
  }
}

test("003 EARS-44: the Congress hand-off opens the code step with the code already sent, and the code lands on /account/congress", async ({
  page,
}) => {
  const email = `e2e-2626-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@ds.test`;
  const ref = await signUpForCongress(email);

  const sentAt = Date.now();
  const response = await page.goto(
    `/login?method=code&handoff=${ref}&returnTo=%2Faccount%2Fcongress`,
  );
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");

  await expect(page.getByTestId("otp-verify")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page).toHaveURL(
    /\/login\?method=code&returnTo=%2Faccount%2Fcongress$/,
  );

  const code = await mailedCode(email, "login", sentAt);
  await page.locator('input[autocomplete="one-time-code"]').fill(code);

  await page.waitForURL((url) => url.pathname === "/account/congress");
});

test("003 EARS-44: an unknown reference falls back to «По коду» with an empty field and no code step", async ({
  page,
}) => {
  await page.goto(
    "/login?method=code&handoff=Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC",
  );

  await expect(page).toHaveURL(/\/login\?method=code$/);
  await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("otp-identifier")).toHaveValue("");
  await expect(page.getByTestId("otp-verify")).toHaveCount(0);
});
