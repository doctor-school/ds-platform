import { describe, expect, it } from "vitest";

import { AcademyHomeView } from "./academy-home-view";
import AcademyHomePage, { metadata } from "./page";
import PublicAcademyChrome from "./@chrome/page";
import { AppShellHeader } from "../components/app-shell-header";

describe("#1311 portal public front door", () => {
  it("renders the approved static Academy home at /", () => {
    expect(AcademyHomePage().type).toBe(AcademyHomeView);
    expect(metadata.title).toBe("Academy home demo — Doctor.School");
  });

  it("#1877: the @chrome slot mounts the app-shell header on /", () => {
    expect(PublicAcademyChrome().type).toBe(AppShellHeader);
  });
});
