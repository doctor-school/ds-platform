import { describe, expect, it } from "vitest";

import { AcademyHomeFooter, AcademyHomeView } from "./academy-home-view";
import AcademyHomePage, { metadata } from "./page";
import PublicAcademyChrome from "./@chrome/page";
import { AcademyShellHeader } from "../components/academy-shell-header";
import HomeFooterSlot from "./@footer/page";
import DefaultFooterSlot from "./@footer/default";
import OtherRouteFooterSlot from "./@footer/[...catchAll]/page";

describe("#1311 portal public front door", () => {
  it("renders the approved static Academy home at /", () => {
    expect(AcademyHomePage().type).toBe(AcademyHomeView);
    expect(metadata.title).toBe("Academy home demo — Doctor.School");
  });

  it("#1877 / #2180: the @chrome slot mounts the SHARED storefront header on /", () => {
    expect(PublicAcademyChrome().type).toBe(AcademyShellHeader);
  });

  it("#2664: the @footer slot mounts the home footer on / — after the layout's main, a top-level contentinfo", () => {
    expect(HomeFooterSlot().type).toBe(AcademyHomeFooter);
  });

  it("#2664: the @footer slot renders nothing on every other route", () => {
    expect(DefaultFooterSlot()).toBeNull();
    expect(OtherRouteFooterSlot()).toBeNull();
  });
});
