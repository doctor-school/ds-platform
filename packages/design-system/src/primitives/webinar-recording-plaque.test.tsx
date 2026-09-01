import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WebinarRecordingPlaque } from "./webinar-recording-plaque";

afterEach(cleanup);

/**
 * Neo-brutalist «запись готовится» plaque (014 EARS-7, source
 * `design-source/webinar-archive.dc.html` — the `isPreparing` prep-card
 * artboard). One arm of the mutually exclusive player-card set (design §8.1),
 * occupying the PLAYER position while the recording is unpublished.
 *
 * jsdom pins the two branches the host cannot see from a type signature: the
 * DATED plaque prints the operator's committed readiness day in the time plate,
 * and the UNDATED plaque OMITS that value line entirely (hide-until-content) —
 * no placeholder dash, no invented estimate. All copy is injected, so the tests
 * assert the props' strings, never strings owned by the primitive; the geometry
 * assertions pin the shared WebinarStatusCard card system.
 */
const DATED = {
  timeLabel: "Запись",
  time: "до 18 июля",
  title: "Запись готовится",
  body: "Смонтируем и опубликуем запись до 18 июля — она появится на этой странице.",
};

const UNDATED = {
  timeLabel: "Запись",
  title: "Запись готовится",
  body: "Смонтируем и опубликуем запись — она появится на этой странице.",
};

describe("014 EARS-7 WebinarRecordingPlaque — dated plaque", () => {
  it("EARS-7: when the operator committed to a readiness day, the system shall show it in the time plate beside the label", () => {
    render(<WebinarRecordingPlaque {...DATED} />);
    expect(screen.getByText("Запись")).toBeInTheDocument();
    expect(screen.getByTestId("recording-plaque-date")).toHaveTextContent(
      "до 18 июля",
    );
  });

  it("EARS-7: when the plaque renders, the system shall show the injected head and the one-line explanation", () => {
    render(<WebinarRecordingPlaque {...DATED} />);
    expect(screen.getByText("Запись готовится")).toBeInTheDocument();
    expect(screen.getByText(DATED.body)).toBeInTheDocument();
  });

  it("EARS-7: when the plaque renders, the system shall offer no affordance — «напомнить» notifications are a 014 non-goal", () => {
    render(<WebinarRecordingPlaque {...DATED} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("014 EARS-7 WebinarRecordingPlaque — hide-until-content", () => {
  it("EARS-7: when the operator committed to no readiness day, the system shall render no value line at all", () => {
    render(<WebinarRecordingPlaque {...UNDATED} />);
    expect(screen.queryByTestId("recording-plaque-date")).toBeNull();
    expect(screen.getByText("Запись")).toBeInTheDocument();
    expect(screen.getByText(UNDATED.body)).toBeInTheDocument();
  });

  it("EARS-7: when the readiness day is an explicit null, the system shall render no value line (no placeholder dash)", () => {
    render(<WebinarRecordingPlaque {...UNDATED} time={null} />);
    expect(screen.queryByTestId("recording-plaque-date")).toBeNull();
  });

  it("EARS-7: the undated copy variant is the injected one — the primitive invents no estimate of its own", () => {
    const { container } = render(<WebinarRecordingPlaque {...UNDATED} />);
    expect(container.textContent).toBe(
      `${UNDATED.timeLabel}${UNDATED.title}${UNDATED.body}`,
    );
  });
});

describe("014 EARS-7 WebinarRecordingPlaque — geometry + tokens", () => {
  it("EARS-7: the desktop split is the 196px time-plate grid on a bordered, raised card — the status-card system", () => {
    const { container } = render(<WebinarRecordingPlaque {...DATED} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("layout:grid-cols-[196px_1fr]");
    expect(card.className).toContain("layout:border-2");
    expect(card.className).toContain("layout:shadow-lg");
    expect(card.className).toContain("bg-card");
  });

  it("EARS-7: the readiness day steps down one type size from the status-card clock", () => {
    render(<WebinarRecordingPlaque {...DATED} />);
    const value = screen.getByTestId("recording-plaque-date");
    expect(value.className).toContain("text-xl");
    expect(value.className).toContain("layout:text-2xl");
  });
});
