import { expect, type Page } from "@playwright/test";
import {
  adminOrigin,
  Given,
  SESSION_COOKIE_NAME,
  Then,
  When,
  type MfaWorld,
} from "../support/fixtures";
import {
  bootstrapAdminSession,
  bootstrapDoctorSession,
} from "../support/admin-session";
import { totpCode } from "../support/totp";

/**
 * 011 — the browser steps behind `features/admin-mfa-journey.feature`.
 *
 * Every operator-visible fact these steps assert is read from the RUNNING admin
 * app; every code they submit is derived locally from the secret the enrollment
 * screen rendered (`support/totp.ts` — an independent RFC 6238 implementation,
 * the operator's phone modelled). Nothing here seeds a cookie or a factor: a
 * scenario reaches the challenge screen only by walking enrollment first, so a
 * broken gate fails the suite instead of being stepped around.
 *
 * **The refusal steps assert what a browser can honestly see.** Byte-identity of
 * the failure bodies, the audit rows, the timing band and the replay window are
 * asserted against the API in `apps/api/test/auth/*` — a browser cannot observe
 * any of them, and a test that claimed to would be a weaker check wearing a
 * stronger name. What is asserted here is the operator's side of those same
 * properties: one readable RU message, the same screen, an admin surface that
 * stays shut.
 */

/** The admin-tier session cookie — a protocol constant, checked by absence. */
const ADMIN_SESSION_COOKIE = "__Host-ds_admin_session";
/** The lockout budget the API enforces (`mfa-lockout.service.ts`, ADR-0001 §7). */
const LOCKOUT_THRESHOLD = 10;

function mfa(world: { mfa?: MfaWorld }): MfaWorld {
  if (!world.mfa) {
    throw new Error(
      "no MFA operator in this scenario — a Given must provision one before a code is submitted",
    );
  }
  return world.mfa;
}

/**
 * Start recording the browser's own primary-auth POSTs. The "no second login"
 * claim (LD-1) is then an OBSERVED fact rather than an inference from whatever
 * the DOM happens to show: a verify that quietly re-authenticated would appear
 * here as a POST no step performed.
 */
function watchLogins(page: Page, state: MfaWorld): void {
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/admin\/auth\/login$/.test(req.url())) {
      state.loginPosts.push(req.url());
    }
  });
}

/**
 * A code no earlier step in this scenario has spent, waiting out the current
 * window if it has. A TOTP code is single-use inside its 30-second step, so two
 * submissions in one window would send the same digits — the API refusing the
 * second as a replay is correct behaviour that a naive suite reads as a broken
 * login.
 */
async function freshCode(page: Page, state: MfaWorld): Promise<string> {
  if (!state.secret) {
    throw new Error(
      "no enrollment secret captured — the operator has not been shown the enrollment offer",
    );
  }
  let counter = Math.floor(Date.now() / 1000 / 30);
  while (counter <= state.lastSpentCounter) {
    await page.waitForTimeout(1500);
    counter = Math.floor(Date.now() / 1000 / 30);
  }
  state.lastSpentCounter = counter;
  return totpCode(state.secret, counter * 30_000);
}

/** Whichever code form is on screen — enrollment or challenge. */
function codeForm(page: Page) {
  return page
    .getByTestId("mfa-enroll-form")
    .or(page.getByTestId("mfa-challenge-form"));
}

/**
 * Type a code and wait for the verify round-trip to land, rather than for a
 * particular outcome — the caller decides whether an admission or a refusal was
 * the right answer. The field auto-submits on its sixth digit, so filling IS the
 * submission.
 */
async function submitCode(page: Page, code: string): Promise<void> {
  const settled = page.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/mfa/"),
    { timeout: 20_000 },
  );
  await codeForm(page).getByRole("textbox").fill(code);
  await settled;
}

/** A raw admin-API probe from the page's own cookie jar. */
async function probeAdminApi(
  page: Page,
): Promise<{ status: number; body: string }> {
  return page.evaluate(async () => {
    const res = await fetch("/v1/admin/events", { credentials: "include" });
    return { status: res.status, body: await res.text() };
  });
}

/**
 * Submit the login form once and wait for whatever step the admin tier puts in
 * front of the operator. Retried, because the IdP projects a fresh project-role
 * grant into the token with a short lag: the first login after provisioning can
 * still mint a non-admin token, which the app answers by keeping the operator on
 * `/login`. Every submission is counted, so the "no extra password prompt"
 * assertion compares like with like.
 */
async function signIn(page: Page, state: MfaWorld): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2500);
    await page.goto("/login");
    await page.locator("#email").fill(state.email);
    await page.locator("#password").fill(state.password);
    state.signIns += 1;
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/(events|mfa\/enroll|mfa\/challenge)/, {
        timeout: 8000,
      });
      return;
    } catch {
      /* the grant has not projected yet — submit again */
    }
  }
  throw new Error("the admin login never left the login screen");
}

/** Capture the rendered secret — the string the operator transcribes. */
async function captureSecret(page: Page, state: MfaWorld): Promise<void> {
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  state.secret = secret;
}

// --- Given ------------------------------------------------------------------

Given(
  "a platform_admin account with a valid password and no registered TOTP factor",
  async ({ page, world }) => {
    const { email, password } = await bootstrapAdminSession(adminOrigin());
    world.mfa = {
      email,
      password,
      signIns: 0,
      loginPosts: [],
      lastSpentCounter: -1,
    };
    watchLogins(page, world.mfa);
  },
);

Given(
  "an enrolled platform_admin at the TOTP challenge screen",
  async ({ page, world }) => {
    const { email, password } = await bootstrapAdminSession(adminOrigin());
    const state: MfaWorld = {
      email,
      password,
      signIns: 0,
      loginPosts: [],
      lastSpentCounter: -1,
    };
    world.mfa = state;
    watchLogins(page, state);

    // Enrol through the real gate — the only way to hold a factor whose secret
    // the operator (and therefore this suite) actually knows.
    await signIn(page, state);
    await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
    await captureSecret(page, state);
    await submitCode(page, await freshCode(page, state));
    await page.waitForURL(/\/events/, { timeout: 20_000 });

    await page.getByTestId("sign-out").click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await signIn(page, state);
    await page.waitForURL(/\/mfa\/challenge/, { timeout: 20_000 });
  },
);

Given(
  "a signed-in doctor holding a valid portal session cookie on the admin origin",
  async ({ page }) => {
    const { email, password } = await bootstrapDoctorSession(adminOrigin());
    // The 003 login rides the admin origin's same-origin `/v1/*` proxy, so the
    // portal cookie lands in THIS page's jar — the browser state an operator
    // would really be carrying if they used both surfaces from one machine.
    await page.goto("/login");
    const status = await page.evaluate(async (creds) => {
      const res = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: creds.email,
          password: creds.password,
        }),
      });
      return res.status;
    }, { email, password });
    expect(status, "the 003 portal login must succeed").toBe(200);

    const cookies = await page.context().cookies();
    expect(
      cookies.map((c) => c.name),
      "the portal session cookie must be present for this test to mean anything",
    ).toContain(SESSION_COOKIE_NAME);
  },
);

Given("no admin session cookie is present", async ({ page }) => {
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).not.toContain(ADMIN_SESSION_COOKIE);
});

// --- When -------------------------------------------------------------------

When(
  "the admin signs in at the admin origin with correct credentials",
  async ({ page, world }) => {
    await signIn(page, mfa(world));
  },
);

When(
  "the admin submits the current code from their authenticator",
  async ({ page, world }) => {
    const state = mfa(world);
    if (/\/mfa\/enroll/.test(page.url())) {
      // Re-serve the offer before deriving a code from it. The enrollment offer
      // is deliberately NOT re-servable (011 design): every mount of the screen
      // registers a FRESH provisional factor and the previous secret stops
      // verifying — so any other mount in this browser (the EARS-4 typed-URL
      // probe opens one) leaves THIS tab displaying a superseded secret. A
      // reload is what a real operator who wandered off and came back gets, and
      // it re-syncs the screen with the factor the server actually holds.
      await page.reload();
      await page.getByTestId("mfa-qr").waitFor({ state: "visible" });
      await captureSecret(page, state);
    } else if (!state.secret) {
      await captureSecret(page, state);
    }
    await submitCode(page, await freshCode(page, state));
  },
);

When(
  "the admin submits the incorrect code {string}",
  async ({ page }, code: string) => {
    await submitCode(page, code);
  },
);

When(
  "the admin submits incorrect codes until the account lockout threshold is crossed",
  async ({ page, world }) => {
    // The lock is invisible from the browser BY DESIGN — a locked account, a
    // wrong code and an unregistered factor are one uniform refusal (EARS-7), so
    // this step cannot assert that the lock happened, only spend the budget that
    // causes it. What the scenario then asserts is the property that matters to
    // an operator and to an attacker alike: after this, a CORRECT current code
    // admits nobody.
    //
    // Run the suite with the #1076 ops-window ceilings raised
    // (`RATE_LIMIT_PER_IP_15MIN` / `RATE_LIMIT_PER_USER_15MIN`, see
    // `playwright.config.ts`); at production ceilings the per-user rate window
    // closes first and the refusal proven here is the throttle rather than the
    // lock. Either way nothing is admitted, which is the assertion — but only the
    // raised ceilings make it the LOCK that is proven.
    mfa(world);
    for (let attempt = 0; attempt < LOCKOUT_THRESHOLD; attempt++) {
      await submitCode(page, "000000");
      await expect(page.getByTestId("mfa-error")).toBeVisible();
    }
  },
);

When("the admin signs out", async ({ page }) => {
  await page.getByTestId("sign-out").click();
});

When("an admin route is requested through the admin origin", async ({
  page,
  world,
}) => {
  world.probe = await probeAdminApi(page);
});

// --- Then -------------------------------------------------------------------

Then("the admin is held at the TOTP enrollment screen", async ({ page }) => {
  await expect(page).toHaveURL(/\/mfa\/enroll/);
  await expect(page.getByTestId("mfa-enroll-form")).toBeVisible();
});

Then("the admin is held at the TOTP challenge screen", async ({ page }) => {
  await expect(page).toHaveURL(/\/mfa\/challenge/);
  await expect(page.getByTestId("mfa-challenge-form")).toBeVisible();
});

Then("the enrollment offer is not presented again", async ({ page }) => {
  // Re-offering enrollment to an operator who already holds a factor would
  // silently REPLACE a live second factor — a password-only path to a new
  // credential.
  await expect(page.getByTestId("mfa-qr")).toHaveCount(0);
});

Then("no admin route is reachable", async ({ page }) => {
  // Both halves of "unreachable": the API refuses the pending reference, and the
  // app-level route paints no admin shell an operator could mistake for access.
  const probe = await probeAdminApi(page);
  expect(probe.status).toBe(401);
  expect(probe.body).not.toContain('"items"');

  // …checked in a SECOND tab of the same context, sharing the same cookie jar.
  // Navigating the operator's own tab away and back would remount the enrollment
  // screen, and a remount issues a NEW provisional factor with a new secret —
  // the check would silently invalidate the secret the operator just transcribed
  // and the scenario would fail for a reason it is not about.
  const probeTab = await page.context().newPage();
  try {
    await probeTab.goto("/events");
    await expect(probeTab).not.toHaveURL(/\/events/);
  } finally {
    await probeTab.close();
  }
});

Then(
  "the enrollment offer is both scannable and transcribable",
  async ({ page, world }) => {
    const qr = page.getByTestId("mfa-qr");
    await expect(qr).toBeVisible();
    // Never image-only: an app that cannot scan, and a screen-reader user who
    // cannot scan at all, must still be able to enrol (EARS-12).
    await expect(qr).toHaveAttribute("role", "img");
    expect(await qr.getAttribute("aria-label")).toBeTruthy();
    await captureSecret(page, mfa(world));
  },
);

Then("the admin lands on the admin surface", async ({ page }) => {
  await page.waitForURL(/\/events/, { timeout: 20_000 });
});

Then("the admin API answers this browser", async ({ page }) => {
  // The durable truth under the landing: a real `__Host-ds_admin_session`, live
  // right now — read AFTER the redirect, not merely at the moment of response.
  const probe = await probeAdminApi(page);
  expect(
    probe.status,
    "the verify must have issued a live admin session",
  ).toBe(200);
});

Then(
  "the login was completed in place, with no extra password prompt",
  async ({ world }) => {
    const state = mfa(world);
    expect(
      state.loginPosts.length,
      "a satisfied second factor completes the login in place (LD-1) — no verify may re-authenticate",
    ).toBe(state.signIns);
  },
);

Then("the admin is returned to the login screen", async ({ page }) => {
  await page.waitForURL(/\/login/, { timeout: 20_000 });
});

Then("one refusal in Russian is shown", async ({ page }) => {
  const error = page.getByTestId("mfa-error");
  await expect(error).toHaveCount(1);
  await expect(error).toBeVisible();
  await expect(error).toContainText(/[А-Яа-я]/);
});

Then(
  "the code field is cleared and the submit control cannot act",
  async ({ page }) => {
    // The #1191 Stage-B finding: an enabled submit over an empty code field
    // reads as a broken button, because the six-digit constraint would reject it
    // before any verification path ran.
    await expect(codeForm(page).getByRole("textbox")).toHaveValue("");
    await expect(page.getByTestId("mfa-submit")).toBeDisabled();
  },
);

Then("the request is refused as unauthenticated", async ({ world }) => {
  expect(world.probe?.status).toBe(401);
});

Then("no admin data is returned in the response body", async ({ world }) => {
  expect(world.probe?.body ?? "").not.toContain('"items"');
});

Then(
  "the admin app leaves the browser outside the admin surface",
  async ({ page }) => {
    await page.goto("/events");
    await expect(page).not.toHaveURL(/\/events/);
  },
);
