import { describe, expect, it } from "vitest";

import { DEFAULT_AUTH_FLOW_COPY, resolveAuthFlowCopy } from "./index";

/**
 * #2027 — a field is ONE thing on both storefronts: its words belong to the
 * package and a host varies only the SET of fields it asks for. The override
 * exists for a genuinely host-specific sentence, so this suite pins the three
 * facts a host depends on: silence keeps the defaults, a stated key wins, and
 * stating one key never blanks its siblings.
 */
describe("resolveAuthFlowCopy", () => {
  it("a host that states no override renders the package defaults", () => {
    expect(resolveAuthFlowCopy({})).toBe(DEFAULT_AUTH_FLOW_COPY);
  });

  it("a stated key wins over the package default", () => {
    const copy = resolveAuthFlowCopy({
      copy: { login: { title: "Вход в кабинет" } },
    });

    expect(copy.login.title).toBe("Вход в кабинет");
  });

  it("stating one nested key leaves every sibling sentence standing", () => {
    const copy = resolveAuthFlowCopy({
      copy: { login: { password: { submit: "Продолжить" } } },
    });

    expect(copy.login.password.submit).toBe("Продолжить");
    expect(copy.login.password.identifierLabel).toBe(
      DEFAULT_AUTH_FLOW_COPY.login.password.identifierLabel,
    );
    expect(copy.login.title).toBe(DEFAULT_AUTH_FLOW_COPY.login.title);
    expect(copy.register).toBe(DEFAULT_AUTH_FLOW_COPY.register);
  });

  it("naming a key as undefined states nothing — the default stands", () => {
    const copy = resolveAuthFlowCopy({ copy: { login: { title: undefined } } });

    expect(copy.login.title).toBe(DEFAULT_AUTH_FLOW_COPY.login.title);
  });

  it("the same config hands back the same object, so a memo on it holds", () => {
    const config = { copy: { login: { title: "Вход в кабинет" } } };

    expect(resolveAuthFlowCopy(config)).toBe(resolveAuthFlowCopy(config));
  });
});

/**
 * #2411 — the identifier box is one thing; a host varies only the channel SET.
 * A host that serves no SMS must not promise a phone in any identifier label,
 * placeholder, description or error (canvas `design-source/auth.dc.html`,
 * `isDoctor` branches of `fLoginId` / `fResetId` / `otpIntro` / reset title),
 * the same switch `identifierFieldSchema` already makes for validation.
 */
describe("resolveAuthFlowCopy — identifier wording follows the host channels", () => {
  it("an email-only host gets the canvas email-only identifier strings", () => {
    const copy = resolveAuthFlowCopy({ channels: ["email"] });

    expect(copy.login.password.identifierLabel).toBe("Электронная почта");
    expect(copy.login.password.identifierPlaceholder).toBe(
      "doctor@example.com",
    );
    expect(copy.login.otp.description).toBe(
      "Пришлём код на почту — пароль не нужен.",
    );
    expect(copy.reset.description).toBe(
      "Укажите электронную почту — пришлём код для сброса.",
    );
    expect(copy.reset.identifierLabel).toBe("Электронная почта");
    expect(copy.reset.identifierPlaceholder).toBe("doctor@example.com");
    expect(copy.fields.identifier?.invalid).toBe(
      "Введите корректный адрес электронной почты.",
    );
    expect(copy.login.title).toBe(DEFAULT_AUTH_FLOW_COPY.login.title);
  });

  it("a host serving SMS keeps the email-or-phone strings unchanged", () => {
    const copy = resolveAuthFlowCopy({ channels: ["email", "sms"] });

    expect(copy).toEqual(DEFAULT_AUTH_FLOW_COPY);
    expect(copy.login.password.identifierLabel).toBe(
      "Электронная почта или телефон",
    );
  });

  it("a host override still wins over the email-only wording", () => {
    const copy = resolveAuthFlowCopy({
      channels: ["email"],
      copy: { login: { password: { identifierLabel: "Почта" } } },
    });

    expect(copy.login.password.identifierLabel).toBe("Почта");
    expect(copy.reset.identifierLabel).toBe("Электронная почта");
  });
});
