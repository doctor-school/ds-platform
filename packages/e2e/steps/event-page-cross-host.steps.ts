import { expect, type Page } from "@playwright/test";
import { golden } from "@ds/db/seed/golden";

import { baseUrlFor, hostById, type HostConfig } from "../hosts.js";
import { Then, When, type StepWorld } from "./support/fixtures.js";

/**
 * 020 EARS-18 — one account across the two storefronts (gate row 27, #1775).
 *
 * The scenario signs in on the project's own host through the shared golden
 * sign-in (`Given the golden doctor … is signed in`) and then opens the SAME
 * event on the other host in the SAME browser context. The two hosts hold
 * separate `__Host-` session cookies (ADR-0015 §4), so whatever carries the
 * doctor across is the platform's one-account mechanism, not a cookie this
 * test could share by accident.
 *
 * The golden recorded event is the probe because its render is binary on
 * authentication (020 EARS-5): a guest gets the recording sign-in gate, a
 * signed-in doctor gets the player meta line.
 */
const RECORDED = golden.events.pastWithRecording;
const SIGN_IN_GATE_TITLE = "Войдите, чтобы посмотреть запись";

interface CrossHostVisit {
  page: Page;
  host: HostConfig;
  /** Every main-frame URL the other host's tab passed through. */
  navigations: string[];
}

const visits = new WeakMap<StepWorld, CrossHostVisit>();

function otherHostOf(host: HostConfig): HostConfig {
  return hostById(host.id === "doctor" ? "academy" : "doctor");
}

function visitOf(world: StepWorld): CrossHostVisit {
  const visit = visits.get(world);
  if (!visit) throw new Error("The event was not opened on the other host");
  return visit;
}

When(
  "the doctor opens the golden recorded event on the other storefront",
  async ({ context, world }) => {
    const other = otherHostOf(world.host);
    const page = await context.newPage();
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await page.goto(
      `${baseUrlFor(other)}${other.eventsPath}/${RECORDED.slug}`,
      { waitUntil: "load" },
    );
    visits.set(world, { page, host: other, navigations });
  },
);

Then(
  "the other storefront renders the recording player, not the sign-in gate",
  async ({ world }) => {
    const { page, host } = visitOf(world);
    const eventUrl = new URL(
      `${baseUrlFor(host)}${host.eventsPath}/${RECORDED.slug}`,
    );
    await page.waitForURL(
      (url) =>
        url.origin === eventUrl.origin && url.pathname === eventUrl.pathname,
    );
    await expect(page.getByTestId("recording-meta")).toBeVisible();
    await expect(page.getByText(SIGN_IN_GATE_TITLE)).toHaveCount(0);
  },
);

Then(
  "the doctor was never sent to the other storefront's sign-in screen",
  async ({ world }) => {
    const { host, navigations } = visitOf(world);
    const origin = new URL(baseUrlFor(host)).origin;
    const signInHops = navigations.filter((href) => {
      const url = new URL(href);
      return url.origin === origin && url.pathname === host.loginPath;
    });
    expect(signInHops).toEqual([]);
  },
);
