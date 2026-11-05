import { NOT_FOUND_COPY } from "@ds/storefront-shell/not-found-copy";
import { describe, expect, it } from "vitest";

import { maskNotFoundVariant } from "./not-found-page";

describe("maskNotFoundVariant", () => {
  it("makes two renders with different variants compare equal", () => {
    const [a, b] = NOT_FOUND_COPY.variants;
    const render = (v: { title: string; text: string }) =>
      `Шапка\n${v.title}\n${v.text}\n${NOT_FOUND_COPY.home}\nПодвал`;
    expect(maskNotFoundVariant(render(a!))).toBe(maskNotFoundVariant(render(b!)));
    expect(maskNotFoundVariant(render(a!))).toContain("Шапка");
  });
});
