import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  LeadDemoFields,
  type LeadDemoFieldsProps,
} from "./lead-demo-fields";

type SubmitAction = LeadDemoFieldsProps["submitAction"];
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
  it("EARS-5: when the visitor reaches the enabled form, portal shall expose the exact validated controls and accessible errors", async () => {
    const user = userEvent.setup();
    const submitAction = vi.fn<SubmitAction>();
    render(<LeadDemoFields submitAction={submitAction} />);

    const nameControl = screen.getByLabelText(/^Имя/);
    expect(nameControl).toBeEnabled();
    expect(nameControl).toHaveAttribute("id", "academy-partner-name-field");
    expect(screen.getByLabelText("Компания или клиника")).toBeEnabled();
    expect(screen.getByLabelText(/^Email или Telegram/)).toHaveAttribute(
      "placeholder",
      "name@company.ru или @username",
    );
    expect(
      Array.from(
        screen.getByLabelText(/^Роль/).querySelectorAll("option"),
        (option) => option.textContent,
      ).filter((label) => ROLE_ORDER.includes(label as (typeof ROLE_ORDER)[number])),
    ).toEqual(ROLE_ORDER);
    expect(
      screen.getByRole("link", { name: "Политика конфиденциальности" }),
    ).toHaveAttribute("href", "https://doctor.school/index/privacy-pay");

    await user.type(screen.getByLabelText(/^Email или Telegram/), "@bad-name");
    await user.click(
      screen.getByRole("button", { name: "Обсудить партнёрство" }),
    );

    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    const summary = screen.getByTestId("academy-form-error-summary");
    expect(summary).toHaveFocus();
    const nameErrorLink = within(summary).getByRole("link", {
      name: "Укажите имя.",
    });
    expect(nameErrorLink).toHaveAttribute("href", "#academy-partner-name-field");
    await user.click(nameErrorLink);
    expect(nameControl).toHaveFocus();
    expect(submitAction).not.toHaveBeenCalled();
    await act(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, 120)),
    );
  });

  it("EARS-5: an invalid touched contact shall still validate on blur before submit", async () => {
    const user = userEvent.setup();
    const submitAction = vi.fn<SubmitAction>();
    render(<LeadDemoFields submitAction={submitAction} />);

    await user.type(screen.getByLabelText(/^Email или Telegram/), "@bad-name");
    await user.tab();

    expect(
      (await screen.findAllByText(
        "Укажите корректный email или Telegram в формате @username.",
      ))[0],
    ).toBeVisible();
    expect(submitAction).not.toHaveBeenCalled();
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
    expect(screen.queryByText("Спасибо! Заявка сохранена.")).not.toBeInTheDocument();

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
    expect(failure.compareDocumentPosition(
      screen.getByRole("button", { name: "Обсудить партнёрство" }),
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByLabelText(/^Имя/)).toHaveValue(VALID_NAME);
    expect(screen.getByLabelText(/^Email или Telegram/)).toHaveValue(VALID_CONTACT);
    expect(screen.queryByText("Спасибо! Заявка сохранена.")).not.toBeInTheDocument();
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

  it("EARS-8: submit shall use the canonical on-primary surface treatment", () => {
    render(<LeadDemoFields submitAction={vi.fn<SubmitAction>()} />);

    const submit = screen.getByRole("button", {
      name: "Обсудить партнёрство",
    });
    expect(submit).toHaveClass(
      "border-header-foreground",
      "bg-header-foreground",
      "text-header-chip-foreground",
      "shadow-header-chip",
    );
    expect(submit).not.toHaveClass("bg-primary-action");
  });
});
