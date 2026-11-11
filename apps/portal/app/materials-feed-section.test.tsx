import * as React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AcademyHomeView } from "./academy-home-view";
import { MaterialsFeedSection } from "./materials-feed-section";

afterEach(() => {
  vi.unstubAllGlobals();
});

function homeSections(): React.ReactElement[] {
  const view = AcademyHomeView() as React.ReactElement<{
    children: React.ReactElement<{ children: React.ReactElement[] }>;
  }>;
  return React.Children.toArray(
    view.props.children.props.children,
  ) as React.ReactElement[];
}

describe("048 Academy home feed section", () => {
  it("048 EARS-14: when a visitor opens the Academy home, system shall render the feed section after the events block", () => {
    const types = homeSections().map((section) => section.type);
    const feed = types.indexOf(MaterialsFeedSection);

    expect(feed).toBeGreaterThan(0);
    expect((types[feed - 1] as { name?: string }).name).toBe("EventsSection");
  });

  it("048 EARS-14: the section reads the feed in the browser and keeps the reading page's way back anchor", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [], nextCursor: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<MaterialsFeedSection />);

    expect(
      screen.getByRole("heading", { name: "Новости, блог и видео" }),
    ).toBeInTheDocument();
    expect(container.querySelector("#feed-h")).not.toBeNull();
    expect(await screen.findByText("Записей пока нет.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/public/feed?limit=12",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
