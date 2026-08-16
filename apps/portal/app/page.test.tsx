import { describe, expect, it } from "vitest";

import { AcademyHomeView } from "./academy-home-view";
import AcademyHomePage, { metadata } from "./page";

describe("#1311 portal public front door", () => {
  it("renders the approved static Academy home at /", () => {
    expect(AcademyHomePage().type).toBe(AcademyHomeView);
    expect(metadata.title).toBe("Academy home demo — Doctor.School");
  });
});
