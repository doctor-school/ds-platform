import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoomUserCluster } from "./room-user-cluster";

/**
 * 006 EARS-15 on the DOCTOR host — «where a gated doctor's room renders, the
 * room header shall display an avatar carrying the initials derived from that
 * doctor's real display name».
 *
 * The shared unit (`packages/room`) covers the SLOT; what it cannot cover is
 * whether this storefront actually fills it, which is the regression this file
 * pins: the room shipped its first slice with the toggle alone, and the header
 * silently carried no avatar.
 *
 * Static server markup, the app's existing unit tier — the assertion is about
 * what reaches the HTML, and the cluster has no client-side behaviour of its own.
 *
 * There is deliberately NO «no display name» case: that branch is unreachable by
 * construction. `room-client.tsx` renders the EARS-14 JIT prompt INSTEAD of the
 * room while the saved name is `null`, so the room — and this cluster — only ever
 * composes once a real name exists. Testing it would test a dead branch.
 */
describe("006 EARS-15: the doctor room header carries the initials avatar", () => {
  it("006 EARS-15.1: the cluster renders the initials of the doctor's saved name beside the theme toggle", () => {
    const html = renderToStaticMarkup(
      <RoomUserCluster
        displayName="Анна Петрова"
        avatarLabel="Ваш профиль: Анна Петрова"
      />,
    );

    expect(html).toContain('data-testid="room-avatar"');
    expect(html).toContain(">АП<");
    expect(html).toContain('aria-label="Ваш профиль: Анна Петрова"');
    // The 017 storefront theme toggle is the same control the shell header
    // mounts — the cluster is the pair, not the chip alone (EARS-12).
    expect(html).toContain("Включить тёмную тему");
  });

  it("006 EARS-15.3: the chip is the shared header-chip surface, desktop-only", () => {
    const html = renderToStaticMarkup(
      <RoomUserCluster
        displayName="Анна Петрова"
        avatarLabel="Ваш профиль: Анна Петрова"
      />,
    );

    // The `header` Avatar variant — the canvas white-on-navy chip, the same
    // surface the academy's interactive chip composes (one DS constant). The
    // `default` fill would be the header's own navy: invisible on the band.
    expect(html).toContain("bg-header-foreground");
    expect(html).toContain("text-header-chip-foreground");
    expect(html).toContain("shadow-header-chip");
    expect(html).not.toContain("bg-primary-action");
    // Desktop-only, like the academy room: the 390px canvas header has no chip.
    expect(html).toMatch(/class="[^"]*\bhidden\b[^"]*\blayout:inline-flex\b/);
  });

  it("006 EARS-15.2: a single-word name yields one initial and still no fabricated glyph", () => {
    const html = renderToStaticMarkup(
      <RoomUserCluster displayName="Пирогов" avatarLabel="Ваш профиль: Пирогов" />,
    );

    expect(html).toContain(">П<");
  });
});
