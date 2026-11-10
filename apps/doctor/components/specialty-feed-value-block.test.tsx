import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeedValueBlock } from "@ds/schemas";

import { SpecialtyFeedValueBlock } from "@/components/specialty-feed-value-block";

/**
 * 018 EARS-7 — the «Зачем это мне» block renders what the envelope carries.
 * Static server markup keeps the doctor unit tier on its node environment; the
 * browser tier (`e2e/feed-value-block.spec.ts`) scans the real page.
 */
const BLOCK: FeedValueBlock = {
  kind: "value",
  items: [
    { title: "Первый пункт", body: "Тело первого." },
    { title: "Второй пункт", body: "Тело второго." },
    { title: "Третий пункт", body: "Тело третьего." },
    { title: "Четвёртый пункт", body: "Тело четвёртого." },
  ],
  freeStatement: "Утверждение из конверта",
};

describe("018 EARS-7: the value block renders the envelope's copy", () => {
  it("EARS-7: eyebrow and heading, then the four items in envelope order, closing on the free statement", () => {
    const html = renderToStaticMarkup(
      <SpecialtyFeedValueBlock block={BLOCK} />,
    );

    expect(html).toContain("Ценность");
    expect(html).toMatch(/<h2[^>]*>Зачем это мне<\/h2>/);
    expect(html).toContain('data-screen-label="d-feed · зачем это мне"');
    const at = [
      "Ценность",
      "Зачем это мне",
      ...BLOCK.items.flatMap((item) => [item.title, item.body]),
      BLOCK.freeStatement,
    ].map((text) => html.indexOf(text));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html.trimEnd().lastIndexOf(BLOCK.freeStatement)).toBeGreaterThan(
      html.lastIndexOf(BLOCK.items[3]!.body),
    );
  });

  it("EARS-7: the block adds no wording of its own beside the statement — no payer, no marking", () => {
    const html = renderToStaticMarkup(
      <SpecialtyFeedValueBlock block={BLOCK} />,
    );
    expect(html).not.toMatch(
      /оплачива|партн[её]р|за сч[её]т|инвестор|спонсор|трудоустройств|вниманием/i,
    );
  });
});
