import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorefrontHeader } from "@/components/storefront-header";
import { StorefrontFooter } from "@/components/storefront-footer";

/**
 * 017 EARS-1 / EARS-12 — the shell's both-branches contract.
 *
 * This tier exists because the Playwright tier cannot reach the signed-in
 * branch: the cluster is resolved on the SERVER from the session cookie
 * (`lib/shell-auth.ts`), so no browser-side mock can flip it, and the CI
 * Playwright config is backend-free by design. Rendering the header directly for
 * `guest` and `doctor` is what proves the EARS-1 invariant in BOTH directions —
 * never both clusters, never neither.
 *
 * Static server markup (not jsdom) is deliberate: these are structural
 * assertions about what reaches the HTML, which is exactly the level EARS-1
 * constrains, and it keeps the doctor app's unit tier on its existing node
 * environment with no new component-testing dependencies.
 */
const GUEST_ONLY = ["Войти", "Регистрация"];
const DOCTOR_ONLY = ["Личный кабинет"];

describe("017 EARS-1: exactly one action cluster", () => {
  it("017 EARS-1.1: a guest gets the guest cluster and none of the signed-in one", () => {
    const html = renderToStaticMarkup(
      <StorefrontHeader auth={{ status: "guest" }} />,
    );

    expect(html).toContain('data-cluster="guest"');
    expect(html).not.toContain('data-cluster="doctor"');
    for (const label of GUEST_ONLY) expect(html).toContain(label);
    for (const label of DOCTOR_ONLY) expect(html).not.toContain(label);
  });

  it("017 EARS-1.2: a signed-in doctor gets the signed-in cluster and none of the guest one", () => {
    const html = renderToStaticMarkup(
      <StorefrontHeader auth={{ status: "doctor" }} />,
    );

    expect(html).toContain('data-cluster="doctor"');
    expect(html).not.toContain('data-cluster="guest"');
    for (const label of DOCTOR_ONLY) expect(html).toContain(label);
    for (const label of GUEST_ONLY) expect(html).not.toContain(label);
  });

  it("017 EARS-1.3: exactly one cluster element is emitted in either branch", () => {
    for (const status of ["guest", "doctor"] as const) {
      const html = renderToStaticMarkup(
        <StorefrontHeader auth={{ status }} />,
      );
      const clusters = html.match(/data-testid="shell-action-cluster"/g) ?? [];
      expect(clusters, `cluster count for ${status}`).toHaveLength(1);
    }
  });

  it("017 EARS-1.4: the header renders the logo, the theme control and an EMPTY search slot (LD-6)", () => {
    const html = renderToStaticMarkup(
      <StorefrontHeader auth={{ status: "guest" }} />,
    );

    expect(html).toContain('data-testid="storefront-logo"');
    expect(html).toContain('data-testid="theme-toggle"');
    // The slot is present and self-closing-empty — no input, no control.
    expect(html).toMatch(
      /data-testid="shell-search-slot"[^>]*><\/div>|<div[^>]*data-testid="shell-search-slot"[^>]*>\s*<\/div>/,
    );
    expect(html).not.toContain("<input");
  });

  it("017 EARS-1.5: the header carries no Academy crossing of its own", () => {
    for (const status of ["guest", "doctor"] as const) {
      const html = renderToStaticMarkup(
        <StorefrontHeader auth={{ status }} />,
      );
      expect(html).not.toMatch(/academy\.doctor\.school/i);
    }
  });
});

describe("017 EARS-12: the single Academy crossing lives in the footer", () => {
  it("017 EARS-12.1: the footer emits exactly one Academy link, targeting the Academy home page", () => {
    const html = renderToStaticMarkup(<StorefrontFooter />);

    const links = html.match(/https:\/\/academy\.doctor\.school\//g) ?? [];
    expect(links).toHaveLength(1);
    expect(html).toContain("Academy.Doctor.School");
  });

  it("017 EARS-12.2: the footer carries the «Документы и контакты» links with real targets", () => {
    const html = renderToStaticMarkup(<StorefrontFooter />);

    expect(html).toContain("Документы и контакты");
    expect(html).toContain("Пользовательское соглашение");
    expect(html).toContain("Политика обработки персональных данных");
    expect(html).toContain("Контакты");
    // No dead `#` affordance anywhere in the shell footer.
    expect(html).not.toMatch(/href="#"/);
  });

  it("017 EARS-12.3: the footer never states who finances the doctor's learning", () => {
    const html = renderToStaticMarkup(<StorefrontFooter />);

    expect(html).toContain("Бесплатное образование для врачей");
    for (const forbidden of ["спонсор", "фарм", "оплачива", "финансир"]) {
      expect(html.toLowerCase()).not.toContain(forbidden);
    }
  });
});
