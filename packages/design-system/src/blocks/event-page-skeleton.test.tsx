import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventPageSkeleton } from "./event-page-skeleton";

describe("020 EARS-19 (wave-3 gate row 29) EventPageSkeleton", () => {
  it("EARS-19: the loading state is the canvas skeleton — a busy status region announced by its label only", () => {
    render(<EventPageSkeleton label="Загружаем событие" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Загружаем событие");
    // Canvas L42–L54: 3 blocks in the card, 4 reading lines, 2 aside blocks.
    expect(region.querySelectorAll('[aria-hidden="true"]')).toHaveLength(9);
  });
});
