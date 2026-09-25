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
