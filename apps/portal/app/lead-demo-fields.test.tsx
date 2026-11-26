import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as botProtection from "@ds/auth-flow/bot-protection";
import { SMARTCAPTCHA_NOTICE_URL } from "@ds/auth-flow/bot-protection";

import { LeadDemoFields, type LeadDemoFieldsProps } from "./lead-demo-fields";

const BotProtectionDisclosureSpy = vi.hoisted(() =>
  vi.fn<
    (props: Parameters<typeof botProtection.BotProtectionDisclosure>[0]) => void
  >(),
);

vi.mock("@ds/auth-flow/bot-protection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ds/auth-flow/bot-protection")>();
  return {
    ...actual,
    BotProtectionDisclosure: (
      props: Parameters<typeof actual.BotProtectionDisclosure>[0],
    ) => {
      BotProtectionDisclosureSpy(props);
      return actual.BotProtectionDisclosure(props);
    },
  };
});

type SubmitAction = NonNullable<LeadDemoFieldsProps["submitAction"]>;
type SubmitResult = Awaited<ReturnType<SubmitAction>>;

const VALID_NAME = "  Анна Соколова  ";
const VALID_CONTACT = "  @anna_sokolova  ";
const ROLE_ORDER = [
  "Эксперт",
  "Партнёр",
  "Участник подкаста",
  "Соавтор направления",
  "Компания",
] as const;

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Имя/), VALID_NAME);
  await user.type(screen.getByLabelText(/^Email или Telegram/), VALID_CONTACT);
  await user.selectOptions(screen.getByLabelText(/^Роль/), "Партнёр");
  await user.click(
    screen.getByRole("checkbox", {
      name: /Согласен\(а\) на обработку персональных данных/i,
    }),
  );
}

describe("Feature 013 Academy partnership form", () => {
  describe("delayed field validation", () => {
    afterEach(async () => {
      try {
        cleanup();
        if (vi.isFakeTimers()) {
          await act(async () => {
            await vi.runOnlyPendingTimersAsync();
          });
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("EARS-5: when the visitor reaches the enabled form, portal shall expose the exact validated controls and accessible errors", async () => {
      const user = userEvent.setup();
      const submitAction = vi.fn<SubmitAction>();
      render(<LeadDemoFields submitAction={submitAction} />);

      const nameControl = screen.getByLabelText(/^Имя/);
      expect(nameControl).toBeEnabled();
      expect(nameControl).toBeRequired();
      expect(nameControl).toHaveAttribute("id", "academy-partner-name-field");
      expect(screen.getByLabelText("Компания или клиника")).toBeEnabled();
      const contactControl = screen.getByLabelText(/^Email или Telegram/);
      expect(contactControl).toBeRequired();
      expect(contactControl).toHaveAttribute(
        "placeholder",
        "name@company.ru или @username",
      );
      expect(screen.getByLabelText(/^Роль/)).toBeRequired();
      const consentControl = screen.getByRole("checkbox", {
        name: /Согласен\(а\) на обработку персональных данных/i,
      });
      expect(consentControl).toBeRequired();
      expect(
        Array.from(
          screen.getByLabelText(/^Роль/).querySelectorAll("option"),
          (option) => option.textContent,
        ).filter((label) =>
          ROLE_ORDER.includes(label as (typeof ROLE_ORDER)[number]),
        ),
      ).toEqual(ROLE_ORDER);
      expect(
        screen.getByRole("link", { name: "Политика конфиденциальности" }),
      ).toHaveAttribute("href", "https://doctor.school/index/privacy-pay");

      await user.type(contactControl, "@bad-name");
      // userEvent's async wrapper needs real timers; control the blur delay after typing.
      vi.useFakeTimers();
      act(() => contactControl.blur());
      fireEvent.click(
        screen.getByRole("button", { name: "Обсудить партнёрство" }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(screen.getAllByRole("alert")).not.toHaveLength(0);
      const summary = screen.getByTestId("academy-form-error-summary");
      expect(summary).toHaveFocus();
      expect(consentControl).toHaveAccessibleDescription(
        "Подтвердите согласие на обработку персональных данных.",
      );
      const nameErrorLink = within(summary).getByRole("link", {
        name: "Укажите имя.",
      });
      expect(nameErrorLink).toHaveAttribute(
        "href",
        "#academy-partner-name-field",
      );
      fireEvent.click(nameErrorLink);
      expect(nameControl).toHaveFocus();
      expect(submitAction).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    });

    it("EARS-5: an invalid touched contact shall still validate on blur before submit", async () => {
      const user = userEvent.setup();
      const submitAction = vi.fn<SubmitAction>();
      render(<LeadDemoFields submitAction={submitAction} />);

      const contactControl = screen.getByLabelText(/^Email или Telegram/);
      await user.type(contactControl, "@bad-name");
      vi.useFakeTimers();
      act(() => contactControl.blur());
      const contactError =
        "Укажите корректный email или Telegram в формате @username.";
      await act(async () => {
        await vi.advanceTimersByTimeAsync(99);
      });
      expect(screen.queryByText(contactError)).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(screen.getAllByText(contactError)[0]).toBeVisible();
      expect(submitAction).not.toHaveBeenCalled();
    });
  });

  it("EARS-6: when persistence accepts valid values, portal shall submit once and replace the form only after success", async () => {
    let resolveSubmit: ((result: SubmitResult) => void) | undefined;
    const submitAction = vi.fn<SubmitAction>(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<LeadDemoFields submitAction={submitAction} />);
    await fillValidForm(user);

    await user.click(
      screen.getByRole("button", { name: "Обсудить партнёрство" }),
    );
    expect(submitAction).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("Спасибо! Заявка сохранена."),
    ).not.toBeInTheDocument();

    await act(async () => resolveSubmit?.({ status: "success" }));
    expect(await screen.findByText("Спасибо! Заявка сохранена.")).toBeVisible();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("EARS-7: when persistence fails, portal shall preserve values and show the exact failure above submit", async () => {
    const submitAction = vi.fn<SubmitAction>().mockResolvedValue({
      status: "error",
      message: "Не удалось сохранить заявку. Попробуйте ещё раз.",
    });
    const user = userEvent.setup();
    render(<LeadDemoFields submitAction={submitAction} />);
    await fillValidForm(user);

    await user.click(
      screen.getByRole("button", { name: "Обсудить партнёрство" }),
    );

    await waitFor(() => expect(submitAction).toHaveBeenCalledTimes(1));
    const failure = await screen.findByText(
      "Не удалось сохранить заявку. Попробуйте ещё раз.",
    );
    expect(
      failure.compareDocumentPosition(
        screen.getByRole("button", { name: "Обсудить партнёрство" }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByLabelText(/^Имя/)).toHaveValue(VALID_NAME);
    expect(screen.getByLabelText(/^Email или Telegram/)).toHaveValue(
      VALID_CONTACT,
    );
    expect(
      screen.queryByText("Спасибо! Заявка сохранена."),
    ).not.toBeInTheDocument();
  });

  it("EARS-6: editing preserved values after a failed attempt shall rotate the idempotency key", async () => {
    const submitAction = vi
      .fn<SubmitAction>()
      .mockResolvedValueOnce({
        status: "error",
        message: "Не удалось сохранить заявку. Попробуйте ещё раз.",
      })
      .mockResolvedValueOnce({ status: "success" });
    const user = userEvent.setup();
    render(<LeadDemoFields submitAction={submitAction} />);
    await fillValidForm(user);

    await user.click(
      screen.getByRole("button", { name: "Обсудить партнёрство" }),
    );
    await waitFor(() => expect(submitAction).toHaveBeenCalledTimes(1));
    const firstAttempt = submitAction.mock.calls[0]![0];

    const name = screen.getByLabelText(/^Имя/);
    await user.clear(name);
    await user.type(name, "Мария Петрова");
    await user.click(
      screen.getByRole("button", { name: "Обсудить партнёрство" }),
    );
    await waitFor(() => expect(submitAction).toHaveBeenCalledTimes(2));

    const editedAttempt = submitAction.mock.calls[1]![0];
    expect(editedAttempt.name).toBe("Мария Петрова");
    expect(editedAttempt.idempotencyKey).not.toBe(firstAttempt.idempotencyKey);
  });

  it("EARS-8: while submission is pending, portal shall expose loading and prevent a double submit", async () => {
    let resolveSubmit: ((result: SubmitResult) => void) | undefined;
    const submitAction = vi.fn<SubmitAction>(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<LeadDemoFields submitAction={submitAction} />);
    await fillValidForm(user);
    const submit = screen.getByRole("button", {
      name: "Обсудить партнёрство",
    });

    await user.dblClick(submit);
    await waitFor(() => expect(submitAction).toHaveBeenCalledTimes(1));
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).toBeDisabled();

    await act(async () => resolveSubmit?.({ status: "success" }));
  });

  describe("033 EARS-18 — the queue intake", () => {
    it("EARS-18: a refused bot-protection proof shows the challenge copy, keeps the values and a retry reuses the idempotency key", async () => {
      const submitAction = vi
        .fn<SubmitAction>()
        .mockRejectedValueOnce(
          Object.assign(new Error("refused"), {
            code: "BOT_PROTECTION_REJECTED",
          }),
        )
        .mockResolvedValueOnce({ status: "success" });
      const user = userEvent.setup();
      render(<LeadDemoFields submitAction={submitAction} />);
      await fillValidForm(user);

      await user.click(
        screen.getByRole("button", { name: "Обсудить партнёрство" }),
      );
      expect(
        await screen.findByText(
          "Проверка истекла или не пройдена. Подтвердите ещё раз.",
        ),
      ).toBeVisible();
      expect(
        screen.queryByText("Не удалось сохранить заявку. Попробуйте ещё раз."),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^Имя/)).toHaveValue(VALID_NAME);

      await user.click(
        screen.getByRole("button", { name: "Обсудить партнёрство" }),
      );
      expect(
        await screen.findByText("Спасибо! Заявка сохранена."),
      ).toBeVisible();
      expect(submitAction).toHaveBeenCalledTimes(2);
      expect(submitAction.mock.calls[1]![0].idempotencyKey).toBe(
        submitAction.mock.calls[0]![0].idempotencyKey,
      );
    });

    it("EARS-18: with protection off the attempt is sent once, tokenless", async () => {
      const submitAction = vi
        .fn<SubmitAction>()
        .mockResolvedValue({ status: "success" });
      const user = userEvent.setup();
      render(<LeadDemoFields submitAction={submitAction} />);
      await fillValidForm(user);

      await user.click(
        screen.getByRole("button", { name: "Обсудить партнёрство" }),
      );

      expect(
        await screen.findByText("Спасибо! Заявка сохранена."),
      ).toBeVisible();
      expect(submitAction).toHaveBeenCalledTimes(1);
      expect(submitAction.mock.calls[0]![1]).toBeUndefined();
      expect(
        screen.queryByTestId("smartcaptcha-disclosure"),
      ).not.toBeInTheDocument();
    });

    it("EARS-18: with a site key the form carries the SmartCaptcha disclosure", () => {
      render(
        <LeadDemoFields
          submitAction={vi.fn<SubmitAction>()}
          botProtectionSiteKey="site-key"
        />,
      );

      expect(screen.getByTestId("smartcaptcha-disclosure")).toHaveTextContent(
        "Форма защищена Yandex SmartCaptcha.",
      );
    });

    it("EARS-18: the disclosure is the shared @ds/auth-flow notice on the brand surface", () => {
      render(
        <LeadDemoFields
          submitAction={vi.fn<SubmitAction>()}
          botProtectionSiteKey="site-key"
        />,
      );

      expect(BotProtectionDisclosureSpy).toHaveBeenCalled();
      const props = BotProtectionDisclosureSpy.mock.lastCall![0];
      expect(props.config.botProtection?.siteKey).toBe("site-key");
      expect(props.tone).toBe("on-primary");
      expect(
        within(screen.getByTestId("smartcaptcha-disclosure")).getByRole("link"),
      ).toHaveAttribute("href", SMARTCAPTCHA_NOTICE_URL);
    });
  });

  it("EARS-8: submit shall use the canonical on-primary surface treatment", () => {
    render(<LeadDemoFields submitAction={vi.fn<SubmitAction>()} />);

    const submit = screen.getByRole("button", {
      name: "Обсудить партнёрство",
    });
    expect(submit).toHaveClass(
      "bg-header-foreground",
      "text-header-chip-foreground",
      "shadow-header-chip",
    );
    expect(submit).not.toHaveClass("bg-primary-action");
    expect(submit.className).not.toMatch(/(?:^|\s)border-/);
  });
});
