import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIGN_IN_HOST_ENTRY_HEADER,
  SIGN_IN_HOST_UNAVAILABLE_HEADER,
  writeSignInHostHandOver,
  type SignInHostRender,
} from "@ds/auth-flow/server";
import {
  THEME_FOUC_GUARD,
  THEME_INIT_SCRIPT,
} from "@ds/storefront-shell/theme";
import { ThemeWatcher } from "@ds/storefront-shell/theme-watcher";

import { contentSecurityPolicy } from "../lib/host-headers";

const requestHeaders = { value: new Headers() };
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "font-inter" }),
}));

const { default: RootLayout } = await import("./layout");

const NONCE = "bm9uY2UtMzE3MA==";

function request(storefront: SignInHostRender["storefront"] | null): void {
  const headers = new Headers();
  headers.set("content-security-policy", contentSecurityPolicy(NONCE, false));
  if (storefront) {
    headers.set(
      SIGN_IN_HOST_ENTRY_HEADER,
      writeSignInHostHandOver({
        door: "login",
        render: {
          action: "render",
          storefront,
          door: "login",
          authRequest: "V2_1",
          csrf: "csrf-1",
        },
      }),
    );
  } else {
    headers.set(SIGN_IN_HOST_UNAVAILABLE_HEADER, "unavailable");
  }
  requestHeaders.value = headers;
}

/** Every element of the layout's tree (it is plain JSX, no component boundary). */
function elements(node: ReactNode): ReactElement[] {
  const found: ReactElement[] = [];
  const walk = (value: ReactNode): void => {
    Children.forEach(value, (child) => {
      if (!isValidElement(child)) return;
      found.push(child);
      walk((child.props as { children?: ReactNode }).children);
    });
  };
  walk(node);
  return found;
}

async function layoutTree(): Promise<ReactElement[]> {
  return elements(await RootLayout({ children: <p>door</p> }));
}

function themeScripts(tree: ReactElement[]) {
  return tree
    .filter((el) => el.type === "script")
    .map(
      (el) =>
        el.props as {
          nonce?: string;
          dangerouslySetInnerHTML?: { __html: string };
        },
    );
}

describe("003 EARS-70: the sign-in host follows the originating storefront's theme under the nonce CSP", () => {
  beforeEach(() => {
    requestHeaders.value = new Headers();
  });

  it("003 EARS-70: the Academy variant boots the portal theme (stored choice, else system) with the request nonce and watches the system scheme", async () => {
    request("academy");
    const tree = await layoutTree();
    const scripts = themeScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].nonce).toBe(NONCE);
    expect(scripts[0].dangerouslySetInnerHTML?.__html).toBe(THEME_INIT_SCRIPT);
    expect(tree.some((el) => el.type === ThemeWatcher)).toBe(true);
  });

  it("003 EARS-70: the doctor variant boots the doctor theme (stored choice only, light default) with the request nonce and no system watcher", async () => {
    request("doctor");
    const tree = await layoutTree();
    const scripts = themeScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].nonce).toBe(NONCE);
    expect(scripts[0].dangerouslySetInnerHTML?.__html).toBe(THEME_FOUC_GUARD);
    expect(tree.some((el) => el.type === ThemeWatcher)).toBe(false);
  });

  it("003 EARS-70: with no storefront known (unread entry) the host boots no theme script", async () => {
    request(null);
    const tree = await layoutTree();
    expect(themeScripts(tree)).toHaveLength(0);
    expect(tree.some((el) => el.type === ThemeWatcher)).toBe(false);
  });

  it("003 EARS-70: the CSP the theme script runs under admits no inline script", () => {
    const scriptSrc = contentSecurityPolicy(NONCE, false)
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"));
    expect(scriptSrc).toBe(`script-src 'nonce-${NONCE}' 'strict-dynamic'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
