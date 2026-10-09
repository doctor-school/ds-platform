import { expect, type Locator } from "@playwright/test";

/**
 * A card contact as plain one-line body text (owner Stage-B on #2738): regular
 * weight, no link chip, no wrapping; the full value in the text and `title`.
 * `fits` additionally requires the whole value visible (no ellipsis engaged).
 */
export async function expectOneLineValue(
  fact: Locator,
  value: string,
  width: number,
  fits = false,
): Promise<void> {
  await expect(fact).toHaveText(value);
  const line = fact.locator("[data-one-line-value]");
  await expect(line, `one-line value at ${width}px`).toHaveAttribute(
    "title",
    value,
  );
  await expect(fact.locator("a")).toHaveCount(0);
  const style = await line.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      whiteSpace: s.whiteSpace,
      textOverflow: s.textOverflow,
      fontWeight: s.fontWeight,
      cut: el.scrollWidth > el.clientWidth,
      lines: Math.round(
        el.getBoundingClientRect().height / parseFloat(s.lineHeight),
      ),
    };
  });
  const { cut, ...shape } = style;
  if (fits) expect(cut, `${value} cut at ${width}px`).toBe(false);
  expect(shape, `one-line value at ${width}px`).toEqual({
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontWeight: "400",
    lines: 1,
  });
}
