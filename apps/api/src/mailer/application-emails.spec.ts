import { describe, expect, it } from "vitest";
import {
  applicationReceiptMessage,
  applicationTeamNoticeMessage,
} from "./notice-emails.js";

/**
 * 033 EARS-11, EARS-12 — the two queue emails. Neither builder takes the
 * application: the team notice takes kind, time and the admin link, the
 * receipt takes nothing but the projects link (033-design «Placement»,
 * decision 19), so no body can carry a topic, a name, a company or a contact.
 * The receipt copy is the owner's Stage-A pick on #4029 (2026-11-26).
 */
describe("033 queue emails", () => {
  const projectsUrl = "https://academy.ds.test/projects";

  it("EARS-12: the «Заявка получена» receipt carries the approved generic text and the Academy projects link, and nothing else", () => {
    const message = applicationReceiptMessage(projectsUrl);
    expect(message.subject).toBe("Академия Doctor.School — заявка получена");
    // The preheader is the html's hidden preview line.
    expect(message.html).toContain("Заявка получена");
    for (const line of [
      "Ваша заявка получена. Администратор Академии рассмотрит её и свяжется с вами.",
      "Пока заявка на рассмотрении, посмотрите проекты Академии.",
      "Проекты Академии",
      projectsUrl,
      "Команда Академии Doctor.School",
    ]) {
      expect(message.text).toContain(line);
      expect(message.html).toContain(line);
    }
    // One link only — the projects page.
    expect(message.html.match(/href="/g)).toHaveLength(1);
  });

  it("EARS-11: the team notice carries only the kind, the Moscow submission time and the admin detail link", () => {
    const adminUrl = "https://admin.ds.test/applications/0b1e";
    const message = applicationTeamNoticeMessage({
      kindLabel: "Автор",
      submittedAt: new Date("2026-11-26T09:05:00Z"),
      adminUrl,
    });
    expect(message.subject).toBe(
      "Академия Doctor.School — новая заявка: Автор",
    );
    expect(message.text).toContain("Вид заявки: Автор");
    // 09:05 UTC is 12:05 in Moscow.
    expect(message.text).toContain("12:05");
    expect(message.text).toContain("МСК");
    expect(message.text).toContain(adminUrl);
    expect(message.html).toContain(adminUrl);
    expect(message.html.match(/href="/g)).toHaveLength(1);
  });
});
