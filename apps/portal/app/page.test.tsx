import { afterEach, describe, expect, it, vi } from "vitest";

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

  describe("033 EARS-18: the partnership form's SmartCaptcha site key", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("is read per request from the runtime env the auth doors read", () => {
      vi.stubEnv("SMARTCAPTCHA_SITE_KEY", "  ysc1_runtime_site_key  ");
      expect(AcademyHomePage().props.botProtectionSiteKey).toBe(
        "ysc1_runtime_site_key",
      );
    });

    it("is absent when the env is unset or blank, so the form posts tokenless", () => {
      vi.stubEnv("SMARTCAPTCHA_SITE_KEY", "   ");
      expect(AcademyHomePage().props.botProtectionSiteKey).toBeUndefined();
      vi.stubEnv("SMARTCAPTCHA_SITE_KEY", undefined);
      expect(AcademyHomePage().props.botProtectionSiteKey).toBeUndefined();
    });
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
