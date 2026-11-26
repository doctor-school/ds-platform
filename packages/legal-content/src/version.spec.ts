import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { documentVersionTag } from "./version.js";

describe("documentVersionTag", () => {
  it("033 EARS-6: the version tag is the edition plus the sha256 of the body", () => {
    const body = "Текст согласия.";
    const digest = createHash("sha256").update(body).digest("hex");
    expect(
      documentVersionTag({
        slug: "consent-author-application",
        frontmatter: {
          slug: "consent-author-application",
          title: "Согласие",
          edition: "2026-11-25",
          kind: "consent",
        },
        body,
      }),
    ).toBe(`2026-11-25.sha256-${digest}`);
  });
});
