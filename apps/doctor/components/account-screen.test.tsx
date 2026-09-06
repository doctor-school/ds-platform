import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import { AccountScreen } from "@/components/account-screen";

/**
 * #1958 — what reaches the HTML of the doctor «Личный кабинет».
 *
 * Static server markup, not jsdom, for the reason `vitest.config.ts` states: the
 * doctor unit tier is node-only, and the assertions that belong HERE are
 * structural — the first paint is the honest loading state, the RU copy is this
 * host's own, and the shared block is what will render. The BEHAVIOUR of the
 * surface (the profile read, the inline edit, sign-out) is owned by the shared
 * block's own suite (`packages/design-system/src/blocks/account-profile-card.test.tsx`)
 * and re-confirmed in the real browser at Stage B; duplicating it against a DOM
 * mock would assert the mock.
 */

describe("017 #1958: the doctor account screen", () => {
  it("003 EARS-28: the first server paint is the honest loading state in the doctor host's own RU copy, never a guest-shaped empty cabinet", () => {
    const html = renderToStaticMarkup(<AccountScreen />);

    expect(html).toContain("Загружаем ваш профиль…");
    expect(html).toContain('role="status"');
    // No identity row is painted before the EARS-27 read resolves.
    expect(html).not.toContain('data-testid="profile-email"');
  });
});
