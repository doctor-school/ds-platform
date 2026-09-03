import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventSpeakerCard } from "./event-speaker-card";

afterEach(cleanup);

describe("<EventSpeakerCard>", () => {
  it("020 EARS-1: the speaker card shall render the canvas fields and the expert links a host supplies", () => {
    render(
      <EventSpeakerCard
        name="Михаил Страхов"
        roleKicker="Травматолог-ортопед"
        affiliation="РНИМУ им. Пирогова"
        bio="Д.м.н., профессор кафедры травматологии и ортопедии."
        initials="МС"
        href="/experts/strahov"
        footerLabel="12 эфиров · страница эксперта →"
        footerHref="/experts/strahov"
      />,
    );

    expect(screen.getByText("Ведёт")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Михаил Страхов" })).toHaveAttribute(
      "href",
      "/experts/strahov",
    );
    expect(screen.getByText("Травматолог-ортопед")).toBeInTheDocument();
    expect(screen.getByText("РНИМУ им. Пирогова")).toBeInTheDocument();
    expect(screen.getByTestId("event-speaker-footer-link")).toHaveAttribute(
      "href",
      "/experts/strahov",
    );
    // No photo yet — the canvas falls back to the initials tile, not a gap.
    expect(screen.getByText("МС")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("020 EARS-4: a speaker with no public page shall render as plain text, never as a dead link", () => {
    render(<EventSpeakerCard name="Михаил Страхов" initials="МС" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("event-speaker-footer-link")).toBeNull();
    expect(screen.getByText("Михаил Страхов")).toBeInTheDocument();
  });

  it("020 EARS-1: a supplied photo shall replace the initials tile", () => {
    render(
      <EventSpeakerCard
        name="Михаил Страхов"
        initials="МС"
        photoUrl="/media/strahov.jpg"
      />,
    );

    expect(screen.getByRole("img", { name: "Михаил Страхов" })).toHaveAttribute(
      "src",
      "/media/strahov.jpg",
    );
    expect(screen.queryByText("МС")).toBeNull();
  });
  it("020 EARS-1: a two-speaker section shall carry the canvas heading exactly once (#1764)", () => {
    render(
      <>
        <EventSpeakerCard name="Михаил Страхов" initials="МС" />
        <EventSpeakerCard name="Анна Петрова" initials="АП" heading={null} />
      </>,
    );

    // `heading={null}` SUPPRESSES the label; `undefined` would restore the
    // default «Ведёт» and print one heading per speaker.
    expect(screen.getAllByText("Ведёт")).toHaveLength(1);
  });
});
