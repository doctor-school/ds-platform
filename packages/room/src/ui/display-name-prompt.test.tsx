import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BrowserRoomApi } from "../client/room-api";
import type { RoomCopyStrings } from "../copy/room-copy";
import { DisplayNamePrompt, translateDisplayNameIssue } from "./display-name-prompt";

/**
 * 006 EARS-14 (#1722) — the JIT display-name prompt after the extraction.
 *
 * The Academy version localized its validation through `useLocalizedResolver`
 * (`next-intl` + the portal's `errors.validation` catalogue). The room unit has no
 * catalogue, so D18 replaces that seam with an injected {@link RoomValidationCopy}
 * plus a zod-issue map keyed on the issue's CODE and SHAPE. This suite locks that
 * the specific messages survived the swap — in particular that an over-long name
 * still gets its OWN copy instead of degrading to the generic fallback, which is the
 * exact failure a message-text-keyed map would have introduced.
 */

const copy: Pick<RoomCopyStrings, "displayNamePrompt" | "errors"> = {
  displayNamePrompt: {
    title: "Имя и фамилия",
    description: "Ваше имя будут видеть участники чата эфира",
    label: "Имя и фамилия",
    placeholder: "Иван Иванов",
    submit: "Продолжить",
    error: "Не удалось сохранить имя",
  },
  errors: {
    displayNameRequired: "Укажите имя и фамилию",
    displayNameTooLong: "Имя не длиннее 100 символов",
    required: "Заполните поле",
    fallback: "Проверьте значение",
  },
};

function makeApi(overrides: Partial<BrowserRoomApi> = {}): BrowserRoomApi {
  return {
    postChatMessage: vi.fn(async () => {}),
    sendHeartbeat: vi.fn(async () => ({})),
    refreshChatToken: vi.fn(async () => "token"),
    setDisplayName: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("006 EARS-14 the host-agnostic display-name prompt", () => {
  it("EARS-14: an empty submit is rejected with the INJECTED required copy and never reaches the API", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<DisplayNamePrompt copy={copy} api={api} />);

    await user.click(screen.getByTestId("display-name-submit"));

    expect(
      await screen.findByText(copy.errors.displayNameRequired),
    ).toBeInTheDocument();
    expect(api.setDisplayName).not.toHaveBeenCalled();
  });

  it("EARS-14: a 101-character name shows its OWN too-long copy — never the generic fallback", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<DisplayNamePrompt copy={copy} api={api} />);

    await user.type(screen.getByTestId("display-name-input"), "и".repeat(101));
    await user.click(screen.getByTestId("display-name-submit"));

    expect(
      await screen.findByText(copy.errors.displayNameTooLong),
    ).toBeInTheDocument();
    expect(screen.queryByText(copy.errors.fallback)).toBeNull();
    expect(api.setDisplayName).not.toHaveBeenCalled();
  });

  it("EARS-14: a valid name is persisted TRIMMED through the injected API and fires onSaved", async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const onSaved = vi.fn();
    render(<DisplayNamePrompt copy={copy} api={api} onSaved={onSaved} />);

    await user.type(screen.getByTestId("display-name-input"), "  Иван Петров  ");
    await user.click(screen.getByTestId("display-name-submit"));

    await waitFor(() =>
      expect(api.setDisplayName).toHaveBeenCalledWith("Иван Петров"),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("EARS-16: a refused PUT surfaces the injected submit-failure copy and does NOT fire onSaved", async () => {
    const user = userEvent.setup();
    const api = makeApi({
      setDisplayName: vi.fn(async () => {
        throw new Error("refused");
      }),
    });
    const onSaved = vi.fn();
    render(<DisplayNamePrompt copy={copy} api={api} onSaved={onSaved} />);

    await user.type(screen.getByTestId("display-name-input"), "Иван Петров");
    await user.click(screen.getByTestId("display-name-submit"));

    expect(
      await screen.findByText(copy.displayNamePrompt.error),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("EARS-14: the D18 issue map keys off the zod CODE/SHAPE, so no schema rule degrades to the fallback", () => {
    expect(
      translateDisplayNameIssue(
        { code: "too_small", minimum: 1, path: ["displayName"] },
        copy.errors,
      ),
    ).toBe(copy.errors.displayNameRequired);
    expect(
      translateDisplayNameIssue(
        { code: "too_big", maximum: 100, path: ["displayName"] },
        copy.errors,
      ),
    ).toBe(copy.errors.displayNameTooLong);
    expect(
      translateDisplayNameIssue({ code: "invalid_type", path: ["displayName"] }, copy.errors),
    ).toBe(copy.errors.required);
    // Only a genuinely unmapped issue reaches the last resort.
    expect(
      translateDisplayNameIssue({ code: "unrecognized_keys" }, copy.errors),
    ).toBe(copy.errors.fallback);
  });
});
