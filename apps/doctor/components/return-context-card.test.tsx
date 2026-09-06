import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReturnContextPanel } from "@/components/return-context-card";
import type { ReturnContextEvent } from "@/lib/return-context";

/**
 * #1955 — the return-context panel's ASSURANCE LINE follows the door it stands
 * beside.
 *
 * The panel shipped with one hardcoded line naming an email confirmation, and
 * `/login` reused it verbatim: a doctor who already has an account and arrived
 * from a content gate was told to wait for a letter that sign-in never sends.
 * The card, the eyebrow and the frame are shared; only this sentence forks, so
 * this is the level the fork belongs at and the level it is pinned at.
 *
 * Static server markup, for the reason `vitest.config.ts` states — the panel is
 * a server component and the assertion here is about what reaches the HTML.
 */
const EVENT: ReturnContextEvent = {
  title: "Ортобиология в практике травматолога",
  school: "Школа ортобиологии",
  dateLabel: "12 октября",
  time: "19:00",
  specialties: ["Травматология"],
  speakers: [{ name: "Иванов И. И." }],
};

function render(variant: "register" | "login") {
  return renderToStaticMarkup(
    <ReturnContextPanel event={EVENT} variant={variant} />,
  );
}

describe("021 #1955: the return-context assurance line", () => {
  it("021 #1955.1: the login door promises the return happens on sign-in, not after an email", () => {
    const html = render("login");

    expect(html).toContain("После входа вы вернётесь сюда же — место за вами.");
    // The registration wording is the defect this closes — it must not survive
    // anywhere in the login render.
    expect(html).not.toContain("После подтверждения почты");
  });

  it("021 #1955.2: the registration door keeps its own confirmation wording", () => {
    const html = render("register");

    expect(html).toContain(
      "После подтверждения почты вы вернётесь сюда же — место за вами.",
    );
    expect(html).not.toContain("После входа вы вернётесь");
  });

  it("021 #1955.3: both doors render the same shared card and eyebrow — only the line forks", () => {
    for (const variant of ["login", "register"] as const) {
      const html = render(variant);
      expect(html).toContain('data-testid="return-context-panel"');
      expect(html).toContain('data-testid="return-context-card"');
      expect(html).toContain("Вы вернётесь к этому событию");
      expect(html).toContain(EVENT.title);
    }
  });
});
