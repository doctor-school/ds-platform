// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthLayout } from "@ds/design-system/blocks";

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
      <ReturnContextPanel
        config={DOCTOR_FIXTURE}
        event={EVENT}
        variant="login"
      />,
    );
    const panel = container.querySelector(
      '[data-testid="return-context-panel"]',
    );
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

describe("021 EARS-2 / EARS-3: the card renders beside the form iff the arrival resolved an event", () => {
  it("021 EARS-2: a resolved event gets both compositions, each hidden at the other's breakpoint — one render per viewport", () => {
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

  it("021 EARS-2.6: the plate bleeds by exactly the gutter its form column stands on — no horizontal overflow at 390", () => {
    // #2556 regression: the column moved to the 16px mobile gutter while the
    // plate still bled by the old 24px, widening the 390 page to 398. The bleed
    // and the gutter must be the SAME spacing token, read off the real layout.
    const { container } = render(
      <AuthLayout logo={<span>logo</span>}>
        <ReturnContextPlate config={DOCTOR_FIXTURE} event={EVENT} />
      </AuthLayout>,
    );
    const plate = container.querySelector(
      '[data-testid="return-context-plate"]',
    );
    const column = plate?.parentElement?.parentElement;
    const gutter = column?.className
      .split(" ")
      .find((c) => /^px-/.test(c))
      ?.slice("px-".length);
    const plateClasses = plate?.className.split(" ") ?? [];
    expect(gutter, "the form column declares a mobile gutter").toBeTruthy();
    expect(plateClasses).toContain(`-mx-${gutter}`);
    expect(plateClasses).toContain(`px-${gutter}`);
  });

  it("021 EARS-3: no resolvable return context renders no slot at all — never an empty frame", () => {
    const slots = returnContextSlots({
      config: DOCTOR_FIXTURE,
      event: null,
      variant: "login",
    });

    expect(slots).toEqual({ panel: undefined, plate: undefined });
  });

  it.each(["login", "register"] as const)(
    "021 EARS-2 (#2455): the Academy draws the same card beside the %s door — the canvas `auth` gates it on the return context alone, never on the host",
    (variant) => {
      const slots = returnContextSlots({
        config: ACADEMY_FIXTURE,
        event: EVENT,
        variant,
      });

      expect(slots.panel).toBeDefined();
      expect(slots.plate).toBeDefined();
      const panel = renderToStaticMarkup(<>{slots.panel}</>);
      expect(panel).toContain("Вы вернётесь к этому событию");
      expect(panel).toContain(EVENT.title);
    },
  );

  it("021 EARS-3: a host states no words of its own for the card — the package supplies them", () => {
    const { copy: _omit, ...withoutCopy } = DOCTOR_FIXTURE;
    const config: AuthFlowHostConfig = withoutCopy;

    const slots = returnContextSlots({
      config,
      event: EVENT,
      variant: "login",
    });

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
