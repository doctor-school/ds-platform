import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorefrontAuthCluster } from "@/components/storefront-auth-cluster";
import { DOCTOR_SHELL } from "@/lib/shell-config";

/**
 * 017 EARS-1 / EARS-12 — the doctor host's half of the shared chrome: the auth
 * slot's both-branches contract, plus the host VALUES the package renders.
 *
 * The chrome composition itself is proven once, in
 * `packages/storefront-shell/src/shell.test.tsx`, driven by both host configs —
 * duplicating it here would be re-testing the package. What is host-owned, and
 * therefore tested here, is (a) that exactly one cluster reaches the HTML in
 * either session branch and (b) that the configured destinations are shipped
 * routes with exactly one Academy crossing.
 *
 * This tier exists because the Playwright tier cannot reach the signed-in
 * branch: the cluster is resolved on the SERVER from the session cookie
 * (`lib/shell-auth.ts`), so no browser-side mock can flip it, and the CI
 * Playwright config is backend-free by design.
 *
 * Static server markup (not jsdom) is deliberate: these are structural
 * assertions about what reaches the HTML, which is exactly the level EARS-1
 * constrains.
 */
const GUEST_ONLY = ["Войти", "Регистрация"];
const DOCTOR_ONLY = ["Личный кабинет"];

describe("017 EARS-1: exactly one action cluster", () => {
  it("017 EARS-1.1: a guest gets the guest cluster and none of the signed-in one", () => {
    const html = renderToStaticMarkup(
      <StorefrontAuthCluster auth={{ status: "guest" }} />,
    );

    expect(html).toContain('data-cluster="guest"');
    expect(html).not.toContain('data-cluster="doctor"');
    for (const label of GUEST_ONLY) expect(html).toContain(label);
    for (const label of DOCTOR_ONLY) expect(html).not.toContain(label);
  });

  it("017 EARS-1.2: a signed-in doctor gets the signed-in cluster and none of the guest one", () => {
    const html = renderToStaticMarkup(
      <StorefrontAuthCluster auth={{ status: "doctor" }} />,
    );

    expect(html).toContain('data-cluster="doctor"');
    expect(html).not.toContain('data-cluster="guest"');
    for (const label of DOCTOR_ONLY) expect(html).toContain(label);
    for (const label of GUEST_ONLY) expect(html).not.toContain(label);
  });

  it("017 EARS-1.3: exactly one cluster element is emitted in either branch", () => {
    for (const status of ["guest", "doctor"] as const) {
      const html = renderToStaticMarkup(
        <StorefrontAuthCluster auth={{ status }} />,
      );
      const clusters = html.match(/data-testid="shell-action-cluster"/g) ?? [];
      expect(clusters, `cluster count for ${status}`).toHaveLength(1);
    }
  });

  it("017 EARS-1.4: the cluster carries no Academy crossing of its own (EARS-12)", () => {
    for (const status of ["guest", "doctor"] as const) {
      const html = renderToStaticMarkup(
        <StorefrontAuthCluster auth={{ status }} />,
      );
      expect(html).not.toContain("academy.doctor.school");
    }
  });
});

describe("017 EARS-1 / EARS-12: the doctor host config", () => {
  it("017 EARS-1.5: the header nav is «Эфиры» alone and targets a shipped route", () => {
    expect(DOCTOR_SHELL.nav).toEqual([{ label: "Эфиры", href: "/events" }]);
  });

  it("017 EARS-1.6: the search targets a shipped route, never an invented /search", () => {
    expect(DOCTOR_SHELL.search?.action).toBe("/events");
  });

  it("017 EARS-12.1: exactly one Academy crossing, and it lives in the footer cross column", () => {
    const serialized = JSON.stringify(DOCTOR_SHELL);
    const crossings = serialized.match(/academy\.doctor\.school/g) ?? [];
    expect(crossings).toHaveLength(1);
    expect(DOCTOR_SHELL.footer.cross.href).toBe("https://academy.doctor.school/");
  });

  it("008 EARS-12: the doctor host declares NO hidden paths — the route group scopes the chrome", () => {
    expect(DOCTOR_SHELL.hiddenOnPaths).toBeUndefined();
  });
});
