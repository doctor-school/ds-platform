import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorefrontHeader } from "@ds/storefront-shell";
import type { ServerAuth } from "@ds/auth-flow/server";
import { doctorShellAuthState } from "@/lib/auth-flow-routes";
import { DOCTOR_SHELL } from "@/lib/shell-config";

/**
 * 017 EARS-1 / EARS-12 — the doctor host's half of the shared chrome: the
 * server-resolved sign-in state it hands the package, and the host VALUES the
 * package renders.
 *
 * The chrome composition itself — the chip's look included, since #2180 made the
 * auth cluster package-owned data rather than a host-supplied node — is proven
 * once in `packages/storefront-shell/src/shell.test.tsx`, driven by both host
 * configs. Duplicating it here would be re-testing the package. What is
 * host-owned, and therefore tested here, is (a) that exactly one cluster reaches
 * the HTML in either session branch, with this host's copy, and (b) that the
 * configured destinations are shipped routes with exactly one Academy crossing.
 *
 * This tier exists because the Playwright tier cannot reach the signed-in
 * branch: the state is resolved on the SERVER from the session cookie
 * (`@ds/auth-flow/server`), so no browser-side mock can flip it, and the CI
 * Playwright config is backend-free by design.
 *
 * Static server markup (not jsdom) is deliberate: these are structural
 * assertions about what reaches the HTML, which is exactly the level EARS-1
 * constrains.
 */
const GUEST_ONLY = ["Войти / Регистрация"];
const DOCTOR_ONLY = ["Личный кабинет"];

/** The two branches of `ServerAuth`; the signed-in one carries its claims. */
function authOf(status: "guest" | "doctor"): ServerAuth {
  return status === "doctor"
    ? { status, claims: { sub: "doctor-1", roles: ["doctor"], mfa: false } }
    : { status };
}

function headerHtml(status: "guest" | "doctor"): string {
  return renderToStaticMarkup(
    <StorefrontHeader
      config={DOCTOR_SHELL}
      auth={doctorShellAuthState(authOf(status))}
    />,
  );
}

describe("017 EARS-1: exactly one action cluster", () => {
  it("017 EARS-1.1: a guest gets the guest cluster and none of the signed-in one", () => {
    const html = headerHtml("guest");

    expect(html).toContain('data-cluster="guest"');
    expect(html).not.toContain('data-cluster="doctor"');
    for (const label of GUEST_ONLY) expect(html).toContain(label);
    for (const label of DOCTOR_ONLY) expect(html).not.toContain(label);
  });

  it("017 EARS-1.7: the guest cluster is ONE «Войти / Регистрация» control to the sign-in surface, never a «Войти» + «Регистрация» pair", () => {
    // Canvas `ds-shell.dc.html` line 220: `guestCluster.primary` is the single
    // combined label on BOTH hosts (017 US-7). The Stage-B finding on #2198 was
    // this host drawing two chips while the academy drew one with a third label.
    const html = headerHtml("guest");
    const cluster = html.slice(html.indexOf('data-cluster="guest"'));
    const links = cluster.slice(0, cluster.indexOf("</div>")).match(/<a\b/g) ?? [];
    expect(links).toHaveLength(1);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="/register"');
    expect(html).not.toContain(">Войти<");
    expect(html).not.toContain(">Регистрация<");
  });

  it("017 EARS-1.2: a signed-in doctor gets the signed-in cluster and none of the guest one", () => {
    const html = headerHtml("doctor");

    expect(html).toContain('data-cluster="doctor"');
    expect(html).not.toContain('data-cluster="guest"');
    for (const label of DOCTOR_ONLY) expect(html).toContain(label);
    for (const label of GUEST_ONLY) expect(html).not.toContain(label);
  });

  it("017 EARS-1.3: exactly one cluster element is emitted in either branch", () => {
    for (const status of ["guest", "doctor"] as const) {
      const clusters =
        headerHtml(status).match(/data-testid="shell-auth-cluster"/g) ?? [];
      expect(clusters, `cluster count for ${status}`).toHaveLength(1);
    }
  });

  it("017 EARS-1.8: the signed-in chip is the LABELLED chip, not the academy's initials square", () => {
    // The host owns its copy and the fact that it ships no header display-name
    // read; it does NOT own the chip's look. Omitting `initials` is the whole
    // of that choice (#2180).
    const state = doctorShellAuthState(authOf("doctor"));
    expect(state).toEqual({
      status: "doctor",
      profileHref: "/account",
      label: "Личный кабинет",
    });
    expect(headerHtml("doctor")).toContain('data-testid="shell-avatar"');
  });

  it("017 EARS-1.4: the cluster carries no Academy crossing of its own (EARS-12)", () => {
    for (const status of ["guest", "doctor"] as const) {
      expect(headerHtml(status)).not.toContain("academy.doctor.school");
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
