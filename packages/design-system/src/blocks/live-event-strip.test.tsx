import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiveEventStrip } from "./live-event-strip";

/**
 * 019 EARS-6 — the «Идёт сейчас» strip. The block is presentation only, so the
 * specs assert exactly that: it paints what the server resolved, it announces
 * LIVE to assistive tech (EARS-13), and it owns no policy of its own.
 */
const props = {
  liveLabel: "Идёт сейчас",
  title: "Эфир «Вопросы по PRP»",
  titleHref: "/events/prp-questions",
  meta: "412 в комнате · Школа ортобиологии · до 20:30 МСК",
  actionLabel: "Войти в комнату эфира",
  actionHref: "/events/prp-questions/room",
};

describe("019 EARS-6 · LiveEventStrip", () => {
  it("EARS-6.1: paints the server-resolved title, meta line and event link", () => {
    render(<LiveEventStrip {...props} />);

    const title = screen.getByTestId("live-event-strip-title");
    expect(title).toHaveTextContent("Эфир «Вопросы по PRP»");
    expect(title).toHaveAttribute("href", "/events/prp-questions");
    expect(screen.getByTestId("live-event-strip-meta")).toHaveTextContent(
      "412 в комнате · Школа ортобиологии · до 20:30 МСК",
    );
  });

  it("EARS-6.2: routes the action to the href the server chose and labels it accordingly", () => {
    render(<LiveEventStrip {...props} />);

    const action = screen.getByTestId("live-event-strip-action");
    expect(action).toHaveTextContent("Войти в комнату эфира");
    expect(action).toHaveAttribute("href", "/events/prp-questions/room");
  });

  it("EARS-6.3: an unregistered viewer's action stays on the event page — the block adds no room link of its own", () => {
    render(
      <LiveEventStrip
        {...props}
        actionLabel="Открыть страницу события"
        actionHref="/events/prp-questions"
      />,
    );

    const hrefs = screen
      .getAllByRole("link")
      .map((node) => node.getAttribute("href"));
    expect(hrefs).toEqual([
      "/events/prp-questions",
      "/events/prp-questions",
    ]);
    expect(hrefs.some((href) => href?.endsWith("/room"))).toBe(false);
  });

  it("EARS-13: the LIVE pill is a polite status region so the strip is announced when it appears", () => {
    render(<LiveEventStrip {...props} />);

    expect(screen.getByRole("status")).toHaveTextContent("Идёт сейчас");
  });

  it("EARS-6.4: the section is labelled by the event title and carries the live frame with its live-coloured desktop cast", () => {
    render(<LiveEventStrip {...props} />);

    const section = screen.getByTestId("live-event-strip");
    expect(section.getAttribute("aria-labelledby")).toBe(
      screen.getByTestId("live-event-strip-title").id,
    );
    expect(section.className).toContain("border-live");
    // Token-only: the 6px cast is the `shadow.live` token, desktop-only exactly
    // as the canvas has it (design-source/doctor-events.dc.html L717).
    expect(section.className).toContain("lg:shadow-live");
  });
});
