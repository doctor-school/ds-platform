// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 008 EARS-8/9 — `/` is the canonical public discovery front-door: it RENDERS the
 * shared feature-004 listing (`DiscoveryListing`), no longer redirecting to
 * `/webinars` (the #769 facade) and no longer showing the retired «Каркас
 * приложения» scaffold. The listing is an async server component with its own
 * data layer + coverage; here we pin only that `/` mounts it (the front-door
 * wiring), keeping this test a fast synchronous unit.
 */
vi.mock("@/components/discovery-listing", () => ({
  default: () => <div data-testid="discovery-listing" />,
}));

import HomePage from "./page";

afterEach(() => vi.clearAllMocks());

describe("008 portal front-door — / renders the discovery listing", () => {
  it("EARS-8/9: / renders the discovery listing (no scaffold, no redirect)", () => {
    render(<HomePage />);
    expect(screen.getByTestId("discovery-listing")).toBeInTheDocument();
  });
});
