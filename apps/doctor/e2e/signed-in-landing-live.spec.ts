import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 021 EARS-3 / LD-4 (#2333) — a doctor who SIGNS IN on the doctor storefront
 * lands where an already-signed-in doctor lands, driven end to end.
 *
 * The door's landing is decided at GUEST render, when only the guest cookie can
 * be read; a specialty kept on the PROFILE is visible only once the sign-in has
 * set the session. The login mount therefore hands the door a server action that
 * runs the same `resolveArrivalLanding` rule again on its own request, now
 * carrying the new session cookie. What this tier proves, in a FRESH browser
 * context with no cookies at all (so no guest specialty can explain the result):
 *
 *   (a) a doctor with a PROFILE specialty signs in at `/login` → the specialty
 *       feed `/events`;
 *   (b) the same doctor with a validated `?returnTo=/events/<slug>` → that
 *       event: a carried target still wins (005 EARS-2);
 *   (c) a doctor with NO specialty → the front page `/`.
 *
 * Why a LIVE tier and not the return-context double: the profile specialty is a
 * signed-in api read made by a server action over a real session cookie; a
 * double would assert its own fixture. Accounts are provisioned through the real
 * doctor-host commands (register → confirm with the Mailpit code → sign in →
 * `PUT /v1/me/specialty`), one per test, through an api-request context of its
 * own — the browser context that then signs in never sees those cookies.
 *
 * ENV SET (`playwright.register-live.config.ts`): `E2E_DOCTOR_URL`,
 * `MAILPIT_URL`, `IDP_ISSUER`, `IDP_SERVICE_TOKEN` + `IDP_PROJECT_ID` (the #2232
 * describe narrows an account's project grant to `platform_admin` on the IdP),
 * and `E2E_LANDING_EVENT_SLUG` — a PUBLISHED seeded
 * event slug on the stand's DB (`pnpm --filter @ds/api seed:events`). Bare CI →
 * inert green; a HALF-exported env fails loudly by variable name
 * (`support/live-stand-env.ts`), whose stand preconditions apply (raised
 * rate-limit ceilings; bot protection in its stand bypass mode).
 *
 * STAND TRAP — bind the doctor server to IPv4: `next start -p <port> -H
 * 127.0.0.1`. Bound dual-stack, it forwards the client as `::ffff:127.0.0.1`,
 * the api session fingerprint (#1655, IP/24) no longer matches the one the
 * sign-in minted, and every signed-in server read — this very re-decision —
 * degrades to the guest answer.
 *
 * Harness (dev stand, production build of the doctor host, api on :3000):
 *   E2E_DOCTOR_URL=http://localhost:3004 IDP_ISSUER=… MAILPIT_URL=… \
 *   E2E_LANDING_EVENT_SLUG=<seeded slug> \
 *   pnpm --filter @ds/doctor test:e2e:register-live signed-in-landing-live
 */

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "MAILPIT_URL",
  "IDP_ISSUER",
  "IDP_SERVICE_TOKEN",
  "IDP_PROJECT_ID",
  "E2E_LANDING_EVENT_SLUG",
]);

const DOCTOR_URL = (process.env.E2E_DOCTOR_URL ?? "").replace(/\/$/, "");
const MAILPIT_BASE = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");
const EVENT_SLUG = process.env.E2E_LANDING_EVENT_SLUG ?? "";
/** A specialty code of the seeded catalog (017). */
const PROFILE_SPECIALTY = "kardiologiya";
/** Stable tail of the verify-email subject (BFF `code-emails.ts`, §13.3). */
const VERIFY_SUBJECT = "код подтверждения Doctor.School";

const newEmail = (): string =>
  `e2e-2333-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
const livePassword = (): string => `Doc-${Date.now()}-aA1!`;

/**
 * The confirmation code of the newest verify-email to `email` delivered after
 * `afterIso` — polled, because SMTP delivery is async after the BFF's 2xx.
 */
async function confirmationCode(
  email: string,
  afterIso: string,
): Promise<string> {
  const after = Date.parse(afterIso);
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(
      `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{ ID?: string; Created?: string; Subject?: string }>;
      };
      const hit = (data.messages ?? []).find(
        (m) =>
          m.Created &&
          Date.parse(m.Created) >= after &&
          (m.Subject ?? "").includes(VERIFY_SUBJECT),
      );
      // The branded subject leads with the code (#869).
      const code = hit?.Subject?.match(/^([A-Z0-9]{4,12})\s+—/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no verify-email reached Mailpit for ${email}`);
}

async function expectOk(
  api: APIRequestContext,
  method: "POST" | "PUT",
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  const response = await api.fetch(path, { method, data, headers });
  expect(
    response.ok(),
    `${method} ${path} should succeed — got ${response.status()}: ${await response.text()}`,
  ).toBe(true);
}

/**
 * Provision a confirmed doctor through the doctor host's own commands; with
 * `specialty`, remember it on the PROFILE (never in a browser cookie).
 */
async function provisionDoctor(specialty?: string) {
  const email = newEmail();
  const password = livePassword();
  const api = await playwrightRequest.newContext({ baseURL: DOCTOR_URL });
  try {
    const sentAt = new Date().toISOString();
    await expectOk(api, "POST", "/v1/storefront/doctor/register", {
      email,
      password,
      medicalWorkerDeclaration: true,
      consent: [{ purpose: "partner-data-sharing", version: "v1" }],
    });
    const code = await confirmationCode(email, sentAt);
    await expectOk(api, "POST", "/v1/storefront/doctor/confirm", {
      email,
      code,
    });
    if (specialty) {
      await expectOk(api, "POST", "/v1/auth/login", {
        identifier: email,
        password,
      });
      await expectOk(
        api,
        "PUT",
        "/v1/me/specialty",
        { specialty },
        { "idempotency-key": crypto.randomUUID() },
      );
    }
  } finally {
    await api.dispose();
  }
  return { email, password };
}

/** Sign in through the door's own password form, as a doctor would. */
async function signIn(
  page: Page,
  doctor: { email: string; password: string },
): Promise<void> {
  const form = page.getByTestId("password-login-form");
  await form.getByLabel("Электронная почта", { exact: true }).fill(doctor.email);
  await form.getByLabel("Пароль", { exact: true }).fill(doctor.password);
  await page.getByTestId("password-login-submit").click();
}

test.describe("021 EARS-3: the landing after sign-in on the doctor storefront", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  // Each test provisions an account through a mail round trip.
  test.setTimeout(120_000);

  test("021 EARS-3: a doctor whose specialty is on the PROFILE signs in at /login → the specialty feed", async ({
    page,
    context,
  }) => {
    const doctor = await provisionDoctor(PROFILE_SPECIALTY);
    expect(await context.cookies()).toHaveLength(0);

    await page.goto("/login");
    await signIn(page, doctor);

    await expect(page).toHaveURL(new RegExp(`^${DOCTOR_URL}/events$`));
  });

  test("021 EARS-3: the same doctor carrying ?returnTo=/events/<slug> → that event (a validated target wins)", async ({
    page,
    context,
  }) => {
    const doctor = await provisionDoctor(PROFILE_SPECIALTY);
    expect(await context.cookies()).toHaveLength(0);

    await page.goto(
      `/login?returnTo=${encodeURIComponent(`/events/${EVENT_SLUG}`)}`,
    );
    await signIn(page, doctor);

    await expect(page).toHaveURL(
      new RegExp(`^${DOCTOR_URL}/events/${EVENT_SLUG}$`),
    );
  });

  test("021 EARS-3: a doctor with no remembered specialty signs in at /login → the front page", async ({
    page,
    context,
  }) => {
    const doctor = await provisionDoctor();
    expect(await context.cookies()).toHaveLength(0);

    await page.goto("/login");
    await signIn(page, doctor);

    // Leaves the door, then settles on the front page.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(new RegExp(`^${DOCTOR_URL}/$`));
  });
});

/**
 * #2232 — a signed-in session whose role holds no doctor registration (a
 * `platform_admin`) opens the event page. The api answers the per-user
 * registration read with 403 `insufficient role` (the read is `doctor_guest`
 * only), and the shared SSR read used to throw on it, turning the whole page into
 * a server error. The page must render exactly as for a guest instead: 200, the
 * server-resolved «Участвовать» door, no one-tap. A `doctor_guest` session is
 * unchanged — it still gets the one-tap.
 *
 * The admin is provisioned through the same doctor-host commands as the tests
 * above, then its project grant is NARROWED to `platform_admin` alone on the IdP
 * (the management API the BFF itself uses) — a grant that still carried
 * `doctor_guest` would pass the role check and prove nothing. The role
 * projection lags the grant write, so the sign-in is repeated until the api
 * itself answers the registration read with 403: the precondition is asserted
 * against the live api, never assumed.
 */
const IDP_BASE = (process.env.IDP_ISSUER ?? "").replace(/\/$/, "");

function idpHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN ?? ""}`,
    "content-type": "application/json",
  };
}

/** Replace the account's project grant with `platform_admin` only. */
async function narrowGrantToPlatformAdmin(email: string): Promise<void> {
  const projectId = process.env.IDP_PROJECT_ID ?? "";
  type Grant = { id: string; projectId?: string };
  for (let attempt = 0; attempt < 30; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    const users = await fetch(`${IDP_BASE}/management/v1/users/_search`, {
      method: "POST",
      headers: idpHeaders(),
      body: JSON.stringify({ queries: [{ emailQuery: { emailAddress: email } }] }),
    });
    if (!users.ok) continue;
    const sub = ((await users.json()) as { result?: { id: string }[] })
      .result?.[0]?.id;
    if (!sub) continue;
    const search = await fetch(`${IDP_BASE}/management/v1/users/grants/_search`, {
      method: "POST",
      headers: idpHeaders(),
      body: JSON.stringify({ queries: [{ userIdQuery: { userId: sub } }] }),
    });
    if (!search.ok) continue;
    const grant = (((await search.json()) as { result?: Grant[] }).result ?? [])
      .find((g) => g.projectId === projectId);
    if (!grant) continue;
    const update = await fetch(
      `${IDP_BASE}/management/v1/users/${sub}/grants/${grant.id}`,
      {
        method: "PUT",
        headers: idpHeaders(),
        body: JSON.stringify({ roleKeys: ["platform_admin"] }),
      },
    );
    expect(update.ok, `IdP grant update → ${update.status}`).toBe(true);
    return;
  }
  throw new Error(`no project grant surfaced on the IdP for ${email}`);
}

/**
 * Sign in on the doctor origin (the in-page login through the host's `/v1/*`
 * rewrite, so the cookie carries the page's own fingerprint) and return the
 * status the api gives THIS session for the per-user registration read.
 */
async function signInAndReadRegistration(
  page: Page,
  account: { email: string; password: string },
): Promise<number> {
  await page.context().clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  return page.evaluate(
    async ([identifier, password, slug]) => {
      const login = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      if (login.status !== 200) return -login.status;
      const read = await fetch(
        `/v1/events/${encodeURIComponent(slug)}/registration`,
        { credentials: "include" },
      );
      return read.status;
    },
    [account.email, account.password, EVENT_SLUG] as const,
  );
}

test.describe("#2232 a non-doctor session on the doctor event page", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(180_000);

  test("#2232: a platform_admin session gets the event page rendered as for a guest — 200, the «Участвовать» door, no server error", async ({
    page,
  }) => {
    const admin = await provisionDoctor();
    await narrowGrantToPlatformAdmin(admin.email);

    // The precondition, proven against the live api: THIS session is refused
    // the doctor-only read with 403 (retried while the role projection lags).
    await expect
      .poll(() => signInAndReadRegistration(page, admin), {
        timeout: 90_000,
        intervals: [3_000],
      })
      .toBe(403);

    const response = await page.goto(`/events/${EVENT_SLUG}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Участвовать/ })).toBeVisible();
    await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
    await expect(page.getByText("Вы записаны")).toHaveCount(0);
  });

  test("#2232: a doctor_guest session is unchanged — 200 and the in-place one-tap", async ({
    page,
  }) => {
    const doctor = await provisionDoctor();
    expect(await signInAndReadRegistration(page, doctor)).toBe(200);

    const response = await page.goto(`/events/${EVENT_SLUG}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId("event-register-one-tap")).toBeVisible();
    await expect(page.getByRole("link", { name: /Участвовать/ })).toHaveCount(0);
  });
});
