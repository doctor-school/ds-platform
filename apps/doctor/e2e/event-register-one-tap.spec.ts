import { test, expect } from "@playwright/test";
import { loginAsDoctor, DOCTOR_BASE } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * 005 EARS-1/2/3/4 on doctor.school (#2005) — the live-stand browser tier for
 * one-tap эфир registration on the DOCTOR host.
 *
 * The unit tiers pin the pieces: the page composition
 * (`app/(storefront)/events/[slug]/page.test.tsx`), the completion rule
 * (`packages/events-storefront`), and the two doors that complete it
 * (`components/login-screen.return.test.tsx`,
 * `components/registration-screen.test.tsx`). What ONLY a real stand can prove is
 * that the whole thing composes over a REAL session against the REAL command:
 * that the api participation read admits the doctor origin own
 * `__Host-ds_session`, that the POST it fires actually puts them on the roster,
 * that the server-rendered card then flips to «Вы записаны» IN PLACE without
 * leaving the эфир, and that a second arrival is the idempotent no-op EARS-3
 * promises rather than a duplicate or an error.
 *
 * The academy twin of the same control lives in `apps/portal/e2e` — this file is
 * not a copy of it: the routes, the copy and the way a session is minted differ
 * (`support/doctor-session.ts` explains the same-origin BFF login this host uses).
 * The CONTROL itself is one implementation shared by both hosts
 * (`@ds/events-storefront/ui` `RegisterOneTap`); that is exactly what this tier
 * verifies renders and works on THIS host.
 *
 * ENV SET — export ALL of these to run this spec; exporting SOME of them fails
 * loudly naming the missing ones, while a completely bare environment stays
 * inert-green (the #1871 gate, `support/live-stand-env.ts`):
 *
 * | variable                 | value on the dev stand                            |
 * | ------------------------ | ------------------------------------------------- |
 * | `E2E_DOCTOR_URL`         | the running doctor storefront origin               |
 * | `E2E_DOCTOR_EMAIL`       | the reused doctor account                          |
 * | `E2E_DOCTOR_PASSWORD`    | that account password                              |
 * | `E2E_EVENT_SLUG_ONE_TAP` | an upcoming эфир the account is NOT registered for |
 * | `E2E_EVENT_SLUG_RETURN`  | a SECOND such эфир, for the sign-in return leg     |
 * | `IDP_ISSUER`             | the real Zitadel issuer                            |
 * | `MAILPIT_URL`            | the Mailpit REST base (OTP sink)                   |
 *
 * STAND PRECONDITIONS. Beyond the env set, and unmet they fail this tier against
 * a CORRECT product render:
 *
 * - **The reused doctor must be UNREGISTERED for both slugs.** Registration is
 *   append-only by contract —
 *   `apps/api/src/registration/registration.controller.ts` exposes `POST` and
 *   `GET` and no `DELETE`, because 005 has no cancel clause — so this tier
 *   CONSUMES its two slugs: after a green run the account is on both rosters and
 *   a re-run needs two fresh seeded эфиры (or a re-seeded stand). That is a
 *   property of the requirement, not a gap in the spec; the alternative would be
 *   a test-only unregister path, which is the untracked seam AGENTS.md §6 forbids.
 * - **Raised rate-limit ceilings**, as `support/live-stand-env.ts` states for the
 *   room tier: the logins this file drives from one IP sit above the 003 EARS-13
 *   defaults.
 *
 * WHY THE GUEST SIGN-UP LEG IS NOT DRIVEN HERE. 005 EARS-2 has two doors, and
 * this file drives the SIGN-IN one against a real command. The SIGN-UP one
 * (register, email code, held-password replay, registration) needs a FRESH
 * account per run: self-signup throttles after ~4-5 attempts per window
 * (`support/doctor-session.ts`), so driving it live would make this tier flaky by
 * construction. It is covered instead where it can be observed deterministically:
 * the confirmation journey and its landing in `register-return.spec.ts` (against
 * the `support/return-context-api.mjs` double, which by design cannot observe a
 * real registration), and the ORDER of the held-password replay and the
 * `RegisterForEvent` command it now fires in
 * `components/registration-screen.test.tsx` (005 EARS-2, jsdom).
 */

const ENV = [
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_EMAIL",
  "E2E_DOCTOR_PASSWORD",
  "E2E_EVENT_SLUG_ONE_TAP",
  "E2E_EVENT_SLUG_RETURN",
  "IDP_ISSUER",
  "MAILPIT_URL",
] as const;

requireLiveStandEnv(ENV);

const ONE_TAP_SLUG = process.env.E2E_EVENT_SLUG_ONE_TAP ?? "";
const RETURN_SLUG = process.env.E2E_EVENT_SLUG_RETURN ?? "";

/** The label the api registered participation branch resolves (005 EARS-4). */
const REGISTERED = "Вы записаны";

/** This host own эфир path, never the academy `/webinars/<slug>`. */
function eventPath(slug: string): string {
  return "/events/" + encodeURIComponent(slug);
}

test.describe("005 EARS-1/3/4 (#2005): one-tap registration on the doctor эфир page", () => {
  test("005 EARS-1: a signed-in unregistered doctor registers in place, without leaving the эфир", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto(DOCTOR_BASE + eventPath(ONE_TAP_SLUG));

    const oneTap = page.getByTestId("event-register-one-tap");
    await expect(
      oneTap,
      "E2E_EVENT_SLUG_ONE_TAP must be an upcoming эфир this account is NOT yet registered for — see STAND PRECONDITIONS at the head of this spec",
    ).toBeVisible();
    // The guest door is NOT what a signed-in doctor is shown (020 EARS-5).
    await expect(page.getByRole("link", { name: /Участвовать/ })).toHaveCount(0);

    const urlBefore = page.url();
    await oneTap.click();

    // 005 EARS-4 — the card flips to the registered state IN PLACE: the server
    // page re-renders on router.refresh() and the api answers `registered`.
    await expect(page.getByText(REGISTERED)).toBeVisible();
    await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
    // «in place» is the requirement, so the URL is part of the assertion: no
    // navigation, no confirmation page, no bounce through auth.
    expect(page.url()).toBe(urlBefore);
  });

  test("005 EARS-3: a re-arrival and a reload both stay «Вы записаны» — the command is idempotent", async ({
    page,
  }) => {
    await loginAsDoctor(page);
    await page.goto(DOCTOR_BASE + eventPath(ONE_TAP_SLUG));

    // The test above put this account on the roster; re-arriving shows the
    // outcome and offers no second registration to make.
    await expect(page.getByText(REGISTERED)).toBeVisible();
    await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(REGISTERED)).toBeVisible();
    await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
  });

  test("020 EARS-5: a guest gets the /register door carrying this эфир, and no one-tap", async ({
    page,
  }) => {
    await page.goto(DOCTOR_BASE + eventPath(ONE_TAP_SLUG));

    // No session means no registration state to read and nothing to register:
    // the server-resolved CTA link is the honest next step.
    await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
    const door = page.getByRole("link", { name: /Участвовать/ });
    await expect(door).toBeVisible();
    // The hand-off this host renders: the api resolves the guest CTA
    // (participation-cta.resolver.ts) and the page substitutes THIS host's own
    // event path as the returnTo, because `/webinars/*` is not routed here at all
    // (`app/(storefront)/events/[slug]/page.tsx`, pinned in its unit tier). The
    // academy-shaped `/webinars/<slug>` is what the AUTH doors accept on the way
    // IN (`lib/return-context.ts`), not what the storefront door emits.
    await expect(door).toHaveAttribute(
      "href",
      "/register?returnTo=" + encodeURIComponent("/events/" + ONE_TAP_SLUG),
    );
  });
});

test.describe("005 EARS-2 (#2005): the эфир intent is completed on the way back from sign-in", () => {
  test("005 EARS-2: a doctor who signs in carrying an эфир lands on it ALREADY registered", async ({
    page,
  }) => {
    await page.goto(
      DOCTOR_BASE +
        "/login?returnTo=" +
        encodeURIComponent("/webinars/" + RETURN_SLUG),
    );

    // `exact` matters: the field shares its accessible-name prefix with the
    // «Показать пароль» reveal toggle, so a loose label match is a strict-mode
    // violation (the repo-wide shape — see `login.spec.ts`).
    await page
      .getByLabel("Почта или телефон", { exact: true })
      .fill(process.env.E2E_DOCTOR_EMAIL ?? "");
    await page
      .getByLabel("Пароль", { exact: true })
      .fill(process.env.E2E_DOCTOR_PASSWORD ?? "");
    await page.getByRole("button", { name: "Войти" }).click();

    // Landed on THIS host эфир page, never the academy /webinars/<slug>.
    await page.waitForURL("**" + eventPath(RETURN_SLUG));
    // …and already on the roster: the sign-in fired the registration, so the
    // doctor is never asked to press «Участвовать» a second time.
    await expect(page.getByText(REGISTERED)).toBeVisible();
    await expect(page.getByTestId("event-register-one-tap")).toHaveCount(0);
  });
});
