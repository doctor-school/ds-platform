import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  EventAboutSection,
  EventPageKicker,
  EventProgrammeSection,
} from "./event-left-flow";

/**
 * 020 EARS-2 (#1765) — the shared left-flow sections. The behaviours pinned
 * here are the ones both storefronts inherit by mounting the same blocks.
 */
describe("EventAboutSection", () => {
  it("020 EARS-2.4: renders the host heading over the event description", () => {
    render(
      <EventAboutSection heading="О чём событие" description="Разбор случая." />,
    );
    expect(screen.getByTestId("event-about")).toHaveTextContent("О чём событие");
    expect(screen.getByTestId("event-about")).toHaveTextContent("Разбор случая.");
  });
});

describe("EventProgrammeSection", () => {
  it("020 EARS-2.5: without a PDF the programme block states the lifecycle-specific honest sentence", () => {
    render(
      <EventProgrammeSection
        heading="Программа"
        downloadLabel="Скачать программу (PDF)"
        statement="Программу опубликуем ближе к дате события."
      />,
    );
    const section = screen.getByTestId("event-programme");
    // The section is present — never omitted, never an empty labelled box.
    expect(section).toHaveTextContent("Программа");
    expect(screen.getByTestId("event-programme-statement")).toHaveTextContent(
      "Программу опубликуем ближе к дате события.",
    );
    // And it offers NO control: an absent programme is words, not a dead link.
    expect(section.querySelector("a")).toBeNull();
  });

  it("020 EARS-2.5: with a PDF it renders the download link and no statement", () => {
    render(
      <EventProgrammeSection
        heading="Программа"
        downloadLabel="Скачать программу (PDF)"
        downloadHref="https://cdn.example/programme.pdf"
      />,
    );
    const link = screen.getByRole("link", {
      name: /Скачать программу \(PDF\)/u,
    });
    expect(link).toHaveAttribute("href", "https://cdn.example/programme.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByTestId("event-programme-statement")).toBeNull();
  });
});

describe("EventPageKicker", () => {
  it("020 EARS-2.4: the school is a link only when the host has a school page", () => {
    const { unmount } = render(
      <EventPageKicker school="Школа ортобиологии" formatLabel="Онлайн" />,
    );
    expect(screen.getByTestId("event-page-kicker")).toHaveTextContent(
      "Школа ортобиологии · Онлайн",
    );
    expect(screen.queryByRole("link")).toBeNull();
    unmount();

    render(
      <EventPageKicker
        school="Школа ортобиологии"
        schoolHref="/schools/ortho"
        formatLabel="Онлайн"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Школа ортобиологии" }),
    ).toHaveAttribute("href", "/schools/ortho");
  });
});
