import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
} from "@playwright/test";
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

/**
 * #2659 — the same link opened in a browser that already holds a session (a
 * shared clinic PC). The carried target is `/account/congress` on this host;
 * `E2E_HANDOFF_RETURN_TO` re-points it when the tier is run against the
 * Academy host, whose cabinet has no congress section.
 */
const RETURN_TO = process.env.E2E_HANDOFF_RETURN_TO ?? "/account/congress";
const MAILPIT_BASE = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");

/**
 * How many CODE mails `email` has received, after a settle wait (SMTP delivery
 * is async). The sign-up's own confirmation letter may land at any time, so only
 * the code subjects («… код …», `apps/api/src/mailer/code-emails.ts`) count; a
 * before/after pair of counts sidesteps the stand-to-Mailpit clock skew.
 */
async function codeMailCount(email: string): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const res = await fetch(
    `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const data = (await res.json()) as {
    messages?: Array<{ Subject?: string }>;
  };
  return (data.messages ?? []).filter((m) => /\sкод\s/.test(m.Subject ?? ""))
    .length;
}

/** The session subject the page's browser holds, or the status without one. */
async function sessionSubOf(page: Page): Promise<string | number> {
  return page.evaluate(async () => {
    const res = await fetch("/v1/auth/session", { credentials: "include" });
    return res.ok ? ((await res.json()) as { sub: string }).sub : res.status;
  });
}

/** Redeem `ref` as the page's visitor and type the mailed code. */
async function signInThroughHandoff(
  page: Page,
  email: string,
  ref: string,
): Promise<void> {
  const sentAt = Date.now();
  await page.goto(
    `/login?method=code&handoff=${ref}&returnTo=${encodeURIComponent(RETURN_TO)}`,
  );
  await expect(page.getByTestId("otp-verify")).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  const code = await mailedCode(email, "login", sentAt);
  await page.locator('input[autocomplete="one-time-code"]').fill(code);
  await page.waitForURL((url) => url.pathname === RETURN_TO);
}

test("003 EARS-44 (#2659): signed in as ANOTHER account, the link sends the code to its own account and the code replaces the session", async ({
  page,
  browser,
}) => {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const colleague = `e2e-2659-x-${tag}@ds.test`;
  const registrant = `e2e-2659-y-${tag}@ds.test`;
  const colleagueRef = await signUpForCongress(colleague);
  const registrantRef = await signUpForCongress(registrant);

  await signInThroughHandoff(page, colleague, colleagueRef);
  const colleagueSub = await sessionSubOf(page);
  expect(typeof colleagueSub).toBe("string");
  const [colleagueCookie] = (await page.context().cookies()).filter((c) =>
    c.name.includes("ds_session"),
  );
  expect(colleagueCookie).toBeDefined();
  // A second browser with the same device profile, replaying that cookie: the
  // control below proves it IS the colleague's session before the switch.
  const replaySub = async (): Promise<string | number> => {
    const replay = await browser.newContext({
      locale: "ru-RU",
      userAgent: await page.evaluate(() => navigator.userAgent),
    });
    try {
      await replay.addCookies([colleagueCookie!]);
      const probe = await replay.newPage();
      await probe.goto(`${DOCTOR_URL}/`, { waitUntil: "domcontentloaded" });
      return await sessionSubOf(probe);
    } finally {
      await replay.close();
    }
  };
  expect(await replaySub()).toBe(colleagueSub);

  const colleagueCodes = await codeMailCount(colleague);
  const registrantCodes = await codeMailCount(registrant);
  await signInThroughHandoff(page, registrant, registrantRef);
  const registrantSub = await sessionSubOf(page);
  expect(typeof registrantSub).toBe("string");
  expect(registrantSub).not.toBe(colleagueSub);
  // Exactly one code, to the link's own account; none to the signed-in one.
  expect(await codeMailCount(registrant)).toBe(registrantCodes + 1);
  expect(await codeMailCount(colleague)).toBe(colleagueCodes);

  // The colleague's session is revoked, not merely shadowed in this browser.
  expect(await replaySub()).toBe(401);
});

test("003 EARS-44 (#2659): signed in as the link's OWN account, the link goes straight to the target with no code", async ({
  page,
}) => {
  const email = `e2e-2659-same-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@ds.test`;
  const ref = await signUpForCongress(email);
  await signInThroughHandoff(page, email, ref);
  const sub = await sessionSubOf(page);

  const codesBefore = await codeMailCount(email);
  await page.goto(
    `/login?method=code&handoff=${ref}&returnTo=${encodeURIComponent(RETURN_TO)}`,
  );
  await page.waitForURL((url) => url.pathname === RETURN_TO);
  await expect(page.getByTestId("otp-verify")).toHaveCount(0);
  expect(await sessionSubOf(page)).toBe(sub);
  expect(await codeMailCount(email)).toBe(codesBefore);
});
