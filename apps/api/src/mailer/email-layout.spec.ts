import { expect, it } from "vitest";
import { composeEmail } from "./email-layout.js";

it("EARS-29: a code-bearing email never renders an optional navigation action", () => {
  const message = composeEmail({
    subject: "482916 — code",
    preheader: "Enter your code",
    intro: "Your code:",
    code: { value: "482916", expiry: "One hour" },
    paragraphs: ["Enter it in the requesting tab."],
    action: { label: "Login", url: "https://academy.example.test/login" },
    footer: ["Ignore if not requested."],
  });
  for (const body of [message.html, message.text]) {
    expect(body).not.toMatch(/<a[\s>]|https?:\/\//);
    expect(body).toContain("482916");
    expect(body).toContain("One hour");
  }
});
