import { describe, expect, it, vi } from "vitest";

// #769 facade re-point — the portal front door forwards to the real public
// upcoming-broadcasts listing (`/webinars`, 004 EARS-7). This retires the 003-era
// "Каркас приложения" scaffold card: `/` no longer renders a placeholder, it
// redirects to the product surface that already exists one level deeper.
const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import HomePage from "./page";

describe("#769 portal facade re-point — / front door", () => {
  it("redirects the portal root to the real /webinars listing (no scaffold card)", () => {
    HomePage();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/webinars");
  });
});
