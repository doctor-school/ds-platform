// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthFlowHostConfig } from "../host-config";
import type { ReturnContextEvent } from "../server/return-context";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import {
  ReturnContextPanel,
  ReturnContextPlate,
  returnContextSlots,
} from "./return-context-card";

/**
 * Row 46 — the return-context card beside a door, rendered by the package
 * (#2027 PR 1.5; moved from `apps/doctor/components/return-context-card.test.tsx`).
 *
 * #1955 — the ASSURANCE LINE follows the door it stands beside. The panel shipped
 * with one hardcoded line naming an email confirmation, and `/login` reused it
 * verbatim: a doctor who already has an account and arrived from a content gate
 * was told to wait for a letter that sign-in never sends. The card, the eyebrow
 * and the frame are shared; the sentence forks by VARIANT, and both variants
 * are package defaults — no host restates them.
 *
 * Rendered markup: the card is a server component and the assertion is
 * about what reaches the HTML.
 */
afterEach(cleanup);

/** The HTML a subtree renders to — the assertion is about markup, not interaction. */
function renderToStaticMarkup(node: ReactNode): string {
  const { container } = render(<>{node}</>);
  const html = container.innerHTML;
  cleanup();
  return html;
}

const EVENT: ReturnContextEvent = {
  title: "Ортобиология в практике травматолога",
  school: "Школа ортобиологии",
  dateLabel: "12 октября",
  time: "19:00",
  specialties: ["Травматология"],
  speakers: [{ name: "Иванов И. И." }],
};

function renderPanel(variant: "register" | "login") {
  return renderToStaticMarkup(
    <ReturnContextPanel
      config={DOCTOR_FIXTURE}
      event={EVENT}
      variant={variant}
    />,
  );
}

describe("021 #1955: the return-context assurance line", () => {
  it("021 #1955.1: the login door promises the return happens on sign-in, not after an email", () => {
    const html = renderPanel("login");

    expect(html).toContain("После входа вы вернётесь сюда же — место за вами.");
    // The registration wording is the defect this closes — it must not survive
    // anywhere in the login render.
    expect(html).not.toContain("После подтверждения почты");
  });

  it("021 #1955.2: the registration door keeps its own confirmation wording", () => {
    const html = renderPanel("register");

    expect(html).toContain(
      "После подтверждения почты вы вернётесь сюда же — место за вами.",
    );
    expect(html).not.toContain("После входа вы вернётесь");
  });

  it("021 #1955.3: both doors render the same shared card and eyebrow — only the line forks", () => {
    for (const variant of ["login", "register"] as const) {
      const html = renderPanel(variant);
      expect(html).toContain('data-testid="return-context-panel"');
      expect(html).toContain('data-testid="return-context-card"');
      expect(html).toContain("Вы вернётесь к этому событию");
      expect(html).toContain(EVENT.title);
    }
  });

  it("#2027: the panel's eyebrow and assurance line take the canvas panel measures (auth.dc.html 302/304)", () => {
    const { container } = render(
      <ReturnContextPanel config={DOCTOR_FIXTURE} event={EVENT} variant="login" />,
    );
    const panel = container.querySelector('[data-testid="return-context-panel"]');
    const [eyebrow, assurance] = [
      panel?.firstElementChild,
      panel?.lastElementChild,
    ];

    // Eyebrow: 11px/800/.14em uppercase in #D3E8FD — the brand panel's eyebrow.
    expect(eyebrow?.textContent).toBe("Вы вернётесь к этому событию");
    expect(eyebrow?.className).toContain("tracking-eyebrow");
    expect(eyebrow?.className).toContain("text-primary-surface-soft");
    expect(eyebrow?.className).not.toContain("tracking-micro");
    expect(eyebrow?.className).not.toContain("text-primary-surface-muted");

    // Assurance: 14px on the 1.6 line in #D3E8FD, capped at 44ch.
    expect(assurance?.tagName).toBe("P");
    expect(assurance?.className.split(" ").sort()).toEqual(
      [
        "leading-assurance",
        "max-w-panel-assurance",
        "text-primary-surface-soft",
        "text-sm",
      ].sort(),
    );
  });
});

describe("021 EARS-2 / EARS-3: the card renders beside the form iff the host publishes it", () => {
  it("021 EARS-2: a host with `returnTo.card` gets both compositions, each hidden at the other's breakpoint — one render per viewport", () => {
    const slots = returnContextSlots({
      config: DOCTOR_FIXTURE,
      event: EVENT,
      variant: "login",
    });

    expect(slots.panel).toBeDefined();
    expect(slots.plate).toBeDefined();

    const panel = renderToStaticMarkup(<>{slots.panel}</>);
    const plate = renderToStaticMarkup(<>{slots.plate}</>);
    // Wide layout: the panel shows, the plate is display:none; narrow: the reverse.
    expect(panel).toMatch(
      /data-testid="return-context-panel"[^>]*class="hidden [^"]*layout:flex/,
    );
    expect(plate).toMatch(
      /data-testid="return-context-plate"[^>]*class="[^"]*layout:hidden/,
    );
    // The plate names the event once and carries no assurance line.
    expect(plate.split(EVENT.title)).toHaveLength(2);
    expect(plate).not.toContain("После входа");
  });

  it("021 EARS-3: no resolvable return context renders no slot at all — never an empty frame", () => {
    const slots = returnContextSlots({
      config: DOCTOR_FIXTURE,
      event: null,
      variant: "login",
    });

    expect(slots).toEqual({ panel: undefined, plate: undefined });
  });

  it("021 EARS-3: a host that does not publish the card (Academy) renders no slot even with an event", () => {
    const slots = returnContextSlots({
      config: ACADEMY_FIXTURE,
      event: EVENT,
      variant: "login",
    });

    expect(slots).toEqual({ panel: undefined, plate: undefined });
  });

  it("021 EARS-3: a host flagging the card states no words of its own — the package supplies them", () => {
    const { copy: _omit, ...withoutCopy } = DOCTOR_FIXTURE;
    const config: AuthFlowHostConfig = withoutCopy;

    const slots = returnContextSlots({ config, event: EVENT, variant: "login" });

    expect(slots.panel).toBeDefined();
    expect(slots.plate).toBeDefined();
  });

  it("021 EARS-2: the plate reads its eyebrow from the host copy", () => {
    const html = renderToStaticMarkup(
      <ReturnContextPlate config={DOCTOR_FIXTURE} event={EVENT} />,
    );

    expect(html).toContain('data-testid="return-context-card"');
    expect(html).toContain("Вы вернётесь к этому событию");
  });
});
