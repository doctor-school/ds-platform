import { describe, expect, it } from "vitest";
import { schoolOpenedMessage } from "./notice-emails.js";

/**
 * 023 EARS-7 — the school-opened product notice. Its copy and look are the
 * owner's Stage A pick (023-design §6), so the wording is not pinned here: the
 * test holds what the letter must carry whatever copy is chosen — the school,
 * the course that opened it, one action to the school screen, no code and no
 * money wording.
 */
describe("023 school-opened notice", () => {
  const CONTENT = {
    schoolTitle: "Школа ортобиологии",
    courseTitle: "PRP-терапия в амбулаторной практике",
    schoolUrl: "https://doctor.example.test/schools/orthobiology",
  } as const;

  it("EARS-7: the letter names the school and its first course and leads to the school screen", () => {
    const message = schoolOpenedMessage(CONTENT);

    expect(message.subject).toContain("Школа ортобиологии");
    expect(message.text).toContain("PRP-терапия в амбулаторной практике");
    expect(message.text).toContain(CONTENT.schoolUrl);
    expect(message.html).toContain(`href="${CONTENT.schoolUrl}"`);
    expect(message.html.match(/<a\s/g) ?? []).toHaveLength(1);
  });

  it("EARS-7: the letter carries no money wording", () => {
    const message = schoolOpenedMessage(CONTENT);
    for (const part of [message.subject, message.text, message.html])
      expect(part).not.toMatch(/бесплатн|цен[аы]|оплат|₽|руб/i);
  });
});
