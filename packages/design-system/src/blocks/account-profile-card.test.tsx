import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MyProfile } from "@ds/schemas";

import {
  AccountProfileCard,
  type AccountProfileCardCopy,
} from "./account-profile-card";
import type { AccountPhoneActions } from "./account-phone-row";

/**
 * 003 EARS-27/28 (#1958) — the shared account-profile composition, covering the
 * contract the two host projections depend on: the identity rows, the inline
 * display-name edit routed through the HOST callback, the host-mapped save
 * failure, sign-out, and the honest-empty «Мои события» row.
 *
 * The host-side behaviour (the EARS-9 silent refresh, the EARS-10 redirect
 * target, the route table, the transports) is NOT the block, and is asserted
 * per host: apps/portal/app/account/page.test.tsx for the Academy and
 * apps/doctor/components/account-screen.test.tsx for the doctor storefront.
 */

const copy: AccountProfileCardCopy = {
  title: "Профиль",
  subtitle: "Данные аккаунта, вход и сессия",
  sections: {
    profile: "Профиль",
    security: "Безопасность",
    session: "Сессия",
  },
  nameLabel: "Имя",
  nameEmpty: "не указано",
  nameEdit: "Изменить",
  nameAdd: "Указать",
  nameSave: "Сохранить",
  nameCancel: "Отмена",
  nameInputLabel: "Отображаемое имя",
  emailLabel: "Email",
  emailVerified: "подтверждён",
  phoneLabel: "Телефон",
  phoneEmpty: "не указан",
  phone: {
    add: "Добавить",
    confirm: "Подтвердить",
    change: "Изменить",
    verified: "подтверждён",
    unconfirmedHelper: "Не подтверждён — подтвердите, чтобы входить по SMS",
    suggestedHelper: "Из заявки на конгресс — подтвердите, чтобы входить по SMS",
    confirmedNote: "Телефон подтверждён. Теперь можно входить по коду из SMS",
    inputLabel: "Номер телефона",
    placeholder: "+7…",
    send: "Получить код",
    cancel: "Отмена",
    codeSentTo: "Код отправлен по SMS на",
    codeLabel: "Код из SMS",
    back: "← Изменить номер",
    resend: "Отправить снова",
    resendCountdown: (seconds) => `Отправить снова · ${seconds} с`,
    wrongCode: "Неверный код",
    throttled: "Слишком много попыток. Попробуйте позже",
    unavailable: "Сервис временно недоступен — попробуйте ещё раз.",
  },
  passwordLabel: "Пароль",
  passwordChange: "Сменить пароль",
  passwordHelper: "Отправим код для сброса пароля на email",
  eventsLabel: "События",
  eventsTitle: "Мои события",
  eventsHelper: "Эфиры, записи и сертификаты",
  congressTitle: "Мои заявки на Конгресс",
  signOut: "Выйти из аккаунта",
};

const profile: MyProfile = {
  email: "doctor@example.org",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Анна Сергеева",
  suggestedPhone: null,
};

function renderCard(
  overrides: {
    profile?: MyProfile;
    eventsHref?: string | null;
    congressHref?: string | null;
    passwordHref?: string | null;
    initials?: string | null;
    onSaveDisplayName?: (name: string) => Promise<void>;
    resolveSaveError?: (error: unknown) => string;
    onSignOut?: () => void;
    phoneActions?: AccountPhoneActions;
  } = {},
) {
  const onSaveDisplayName =
    overrides.onSaveDisplayName ?? vi.fn().mockResolvedValue(undefined);
  const onSignOut = overrides.onSignOut ?? vi.fn();
  const phoneActions = overrides.phoneActions ?? phoneActionsMock();
  render(
    <AccountProfileCard
      profile={overrides.profile ?? profile}
      copy={copy}
      initials={overrides.initials === undefined ? "АС" : overrides.initials}
      passwordHref={
        overrides.passwordHref === undefined ? "/reset" : overrides.passwordHref
      }
      eventsHref={
        overrides.eventsHref === undefined
          ? "/account/events"
          : overrides.eventsHref
      }
      congressHref={overrides.congressHref ?? null}
      onSaveDisplayName={onSaveDisplayName}
      resolveSaveError={overrides.resolveSaveError ?? (() => "mapped-error")}
      onSignOut={onSignOut}
      phoneActions={phoneActions}
    />,
  );
  return { onSaveDisplayName, onSignOut, phoneActions };
}

/** A host transport whose rejections the block classifies through the host. */
class PhoneFailure extends Error {
  constructor(readonly kind: "invalid" | "throttled" | "unavailable") {
    super(kind);
  }
}

function phoneActionsMock(
  overrides: Partial<AccountPhoneActions> = {},
): AccountPhoneActions {
  return {
    requestCode: vi.fn().mockResolvedValue("code_sent"),
    confirm: vi.fn().mockResolvedValue("+79134028871"),
    classifyError: (error: unknown) =>
      error instanceof PhoneFailure ? error.kind : "unavailable",
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("AccountProfileCard", () => {
  it("003 EARS-28: renders the identity rows — display name with initials, email with its verified badge, an absent phone as the explicit empty state", () => {
    renderCard();

    expect(screen.getByTestId("profile-name")).toHaveTextContent(
      "Анна Сергеева",
    );
    expect(screen.getByTestId("profile-avatar")).toHaveTextContent("АС");
    expect(screen.getByTestId("profile-email")).toHaveTextContent(
      "doctor@example.org",
    );
    expect(screen.getByTestId("profile-email-verified")).toBeInTheDocument();
    expect(screen.getByTestId("profile-phone")).toHaveTextContent("не указан");
    expect(screen.getByTestId("logout")).toBeInTheDocument();
  });

  it("003 EARS-28: an unverified email renders no verified badge and an unnamed account offers «Указать»", () => {
    renderCard({
      profile: { ...profile, emailVerified: false, displayName: null },
      initials: null,
    });

    expect(screen.queryByTestId("profile-email-verified")).toBeNull();
    expect(screen.queryByTestId("profile-avatar")).toBeNull();
    expect(screen.getByTestId("profile-name")).toHaveTextContent("не указано");
    expect(screen.getByTestId("profile-name-edit")).toHaveTextContent(
      "Указать",
    );
  });

  it("003 EARS-28: the inline edit hands the TRIMMED name to the host write and leaves edit mode once it resolves; Escape cancels", async () => {
    const user = userEvent.setup();
    const { onSaveDisplayName } = renderCard();

    await user.click(screen.getByTestId("profile-name-edit"));
    const input = screen.getByTestId("profile-name-input");
    await user.clear(input);
    await user.type(input, "  Иван Петров  ");
    await user.click(screen.getByTestId("profile-name-save"));

    await waitFor(() =>
      expect(onSaveDisplayName).toHaveBeenCalledWith("Иван Петров"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("profile-name-input")).toBeNull(),
    );

    // The block never mutates the controlled profile — the host owns that.
    expect(screen.getByTestId("profile-name")).toHaveTextContent(
      "Анна Сергеева",
    );

    await user.click(screen.getByTestId("profile-name-edit"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("profile-name-input")).toBeNull();
  });

  it("003 EARS-28: a rejected save keeps the draft open and shows the message the HOST mapped (#175 actionable errors)", async () => {
    const user = userEvent.setup();
    const failure = new Error("boom");
    const resolveSaveError = vi.fn(() => "Не удалось сохранить.");
    renderCard({
      onSaveDisplayName: vi.fn().mockRejectedValue(failure),
      resolveSaveError,
    });

    await user.click(screen.getByTestId("profile-name-edit"));
    await user.clear(screen.getByTestId("profile-name-input"));
    await user.type(screen.getByTestId("profile-name-input"), "Иван");
    await user.click(screen.getByTestId("profile-name-save"));

    await waitFor(() =>
      expect(screen.getByText("Не удалось сохранить.")).toBeInTheDocument(),
    );
    expect(resolveSaveError).toHaveBeenCalledWith(failure);
    // Still editing: the doctor keeps the draft and can retry.
    expect(screen.getByTestId("profile-name-input")).toHaveValue("Иван");
  });

  it("003 EARS-28: «Выйти» calls the host sign-out handler, which owns the revoke and the landing route", async () => {
    const user = userEvent.setup();
    const { onSignOut } = renderCard();

    await user.click(screen.getByTestId("logout"));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("017 EARS-3: a null passwordHref HIDES the whole «Безопасность» section on a host with no recovery door", () => {
    renderCard({ passwordHref: null });

    expect(screen.queryByText("Сменить пароль")).toBeNull();
    expect(screen.queryByText("Безопасность")).toBeNull();
    // The identity rows and the session section are untouched.
    expect(screen.getByTestId("profile-email")).toBeInTheDocument();
    expect(screen.getByTestId("logout")).toBeInTheDocument();
  });

  it("017 EARS-3: a null eventsHref HIDES the «Мои события» row rather than linking at a route the host has not shipped", () => {
    renderCard({ eventsHref: null });

    expect(screen.queryByText("Мои события")).toBeNull();
    // The rest of the «Сессия» section still renders.
    expect(screen.getByTestId("logout")).toBeInTheDocument();
    expect(screen.getByText("Сменить пароль")).toBeInTheDocument();
  });

  it("046 EARS-4: a congressHref renders the «Мои заявки на Конгресс» row linking at the section", () => {
    renderCard({ congressHref: "/account/congress" });

    // The visible row label is exactly the section name the owner was told —
    // no separate small-caps «Конгресс» caption beside it.
    const row = screen.getByRole("link", { name: /Мои заявки на Конгресс/ });
    expect(row).toHaveAttribute("href", "/account/congress");
    expect(row.textContent?.replace("→", "").trim()).toBe("Мои заявки на Конгресс");
  });

  it("046 EARS-4: without a congressHref (no registration for the congress) the row is absent", () => {
    renderCard({ congressHref: null });

    expect(screen.queryByText("Мои заявки на Конгресс")).toBeNull();
    expect(screen.getByTestId("logout")).toBeInTheDocument();
  });
});

describe("#2664 one main landmark per page", () => {
  it("#2664: <AccountProfileCard> renders no main landmark — the host shell owns it", () => {
    renderCard();
    expect(screen.queryByRole("main")).toBeNull();
  });
});

/** Open the entry, type a number and request its code. */
async function requestCodeFor(
  user: ReturnType<typeof userEvent.setup>,
  phone: string,
) {
  await user.click(screen.getByTestId("profile-phone-action"));
  await user.type(screen.getByLabelText("Номер телефона"), phone);
  await user.click(screen.getByTestId("profile-phone-send"));
}

describe("AccountProfileCard — the confirmable phone row (003 #2449)", () => {
  it("003 EARS-50: a congress participant sees the form's number prefilled with its helper and «Подтвердить»; the field opens holding it, editable", async () => {
    const user = userEvent.setup();
    renderCard({ profile: { ...profile, suggestedPhone: "8 913 402 88 71" } });

    expect(screen.getByTestId("profile-phone")).toHaveTextContent(
      "+7 913 402-88-71",
    );
    expect(screen.getByTestId("profile-phone-helper")).toHaveTextContent(
      "Из заявки на конгресс",
    );
    expect(screen.getByTestId("profile-phone-action")).toHaveTextContent(
      "Подтвердить",
    );
    await user.click(screen.getByTestId("profile-phone-action"));
    expect(screen.getByLabelText("Номер телефона")).toHaveValue(
      "8 913 402 88 71",
    );
  });

  it("003 EARS-47: «Добавить» opens the entry; the field takes the EARS-22 phone mask as typed; «Получить код» stays disabled until the number is a valid phone, then requests the code for the masked number", async () => {
    const user = userEvent.setup();
    const { phoneActions } = renderCard();

    expect(screen.getByTestId("profile-phone-action")).toHaveTextContent(
      "Добавить",
    );
    await user.click(screen.getByTestId("profile-phone-action"));
    const input = screen.getByLabelText("Номер телефона");
    expect(screen.getByTestId("profile-phone-send")).toBeDisabled();
    await user.type(input, "8 913");
    expect(screen.getByTestId("profile-phone-send")).toBeDisabled();
    await user.type(input, " 402-88-71");
    await user.click(screen.getByTestId("profile-phone-send"));

    expect(input).toHaveValue("+79134028871");
    expect(phoneActions.requestCode).toHaveBeenCalledWith("+79134028871");
    expect(
      await screen.findByTestId("profile-phone-code-sent"),
    ).toHaveTextContent("Код отправлен по SMS на +7 913 402-88-71");
    expect(screen.getByTestId("profile-phone-resend")).toBeDisabled();
  });

  it("003 EARS-50: the prefilled number stays exactly as typed in the application until the doctor edits it; an edit applies the EARS-22 mask", async () => {
    const user = userEvent.setup();
    const { phoneActions } = renderCard({
      profile: { ...profile, suggestedPhone: "8 (913) 402-88-71" },
    });

    await user.click(screen.getByTestId("profile-phone-action"));
    const input = screen.getByLabelText("Номер телефона");
    expect(input).toHaveValue("8 (913) 402-88-71");
    await user.type(input, "{Backspace}2");
    expect(input).toHaveValue("+79134028872");
    await user.click(screen.getByTestId("profile-phone-send"));
    expect(phoneActions.requestCode).toHaveBeenCalledWith("+79134028872");
  });

  it("003 EARS-47: a request the server refuses as malformed reads as the service message, never as «Неверный код» before any code exists", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        requestCode: vi.fn().mockRejectedValue(new PhoneFailure("invalid")),
      }),
    });

    await requestCodeFor(user, "+79134028871");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сервис временно недоступен",
    );
    expect(screen.queryByText("Неверный код")).toBeNull();
  });

  it("003 EARS-47: while the code is requested the number field is read-only, so the SMS goes to the number the code step names", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        requestCode: vi.fn(() => new Promise<"code_sent">(() => {})),
      }),
    });

    await requestCodeFor(user, "+79134028871");

    expect(screen.getByLabelText("Номер телефона")).toHaveAttribute("readonly");
  });

  it("003 EARS-48: the code-step error is linked to the code field", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        confirm: vi.fn().mockRejectedValue(new PhoneFailure("invalid")),
      }),
    });

    await requestCodeFor(user, "+79134028871");
    await screen.findByTestId("profile-phone-code-sent");
    await user.keyboard("000000");
    const alert = await screen.findByRole("alert");

    expect(alert.id).not.toBe("");
    expect(screen.getByLabelText("Код из SMS")).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(alert.id),
    );
  });

  it("003 EARS-49: leaving the entry or the code step returns the focus to the row action, never to the page", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId("profile-phone-action"));
    await user.click(screen.getByTestId("profile-phone-cancel"));
    expect(screen.getByTestId("profile-phone-action")).toHaveFocus();

    await requestCodeFor(user, "+79134028871");
    await screen.findByTestId("profile-phone-code-sent");
    await user.click(screen.getByTestId("profile-phone-back"));
    expect(screen.getByTestId("profile-phone-action")).toHaveFocus();
  });

  it("003 EARS-48: after a confirmation the focus lands on the row action «Изменить»", async () => {
    const user = userEvent.setup();
    renderCard();

    await requestCodeFor(user, "+79134028871");
    await screen.findByTestId("profile-phone-code-sent");
    await user.keyboard("482913");
    await screen.findByTestId("profile-phone-verified");

    expect(screen.getByTestId("profile-phone-action")).toHaveFocus();
  });

  it("003 EARS-48: six digits submit the code; on success the row shows the server's confirmed number, its badge and the one-time note", async () => {
    const user = userEvent.setup();
    const { phoneActions } = renderCard();

    await requestCodeFor(user, "+79134028871");
    await screen.findByTestId("profile-phone-code-sent");
    await user.keyboard("482913");

    expect(phoneActions.confirm).toHaveBeenCalledWith("482913");
    expect(
      await screen.findByTestId("profile-phone-verified"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("profile-phone")).toHaveTextContent(
      "+7 913 402-88-71",
    );
    expect(screen.getByTestId("profile-phone-note")).toHaveTextContent(
      "Телефон подтверждён",
    );
    expect(screen.getByTestId("profile-phone-action")).toHaveTextContent(
      "Изменить",
    );
  });

  it("003 EARS-48: a wrong code shows the one generic «Неверный код», keeps the code step and writes nothing to the row", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        confirm: vi.fn().mockRejectedValue(new PhoneFailure("invalid")),
      }),
    });

    await requestCodeFor(user, "+79134028871");
    await screen.findByTestId("profile-phone-code-sent");
    await user.keyboard("000000");

    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный код");
    expect(screen.getByTestId("profile-phone-code-sent")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-phone-verified")).toBeNull();
  });

  it("003 EARS-48: while a code is checked the field is read-only, never disabled (a browser drops focus from a disabled field), so after a wrong code the doctor corrects it from the keyboard", async () => {
    const user = userEvent.setup();
    let rejectFirst: (e: unknown) => void = () => {};
    const confirm = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_, reject) => (rejectFirst = reject)),
      )
      .mockResolvedValueOnce("+79134028871");
    renderCard({ phoneActions: phoneActionsMock({ confirm }) });

    await requestCodeFor(user, "+79134028871");
    await screen.findByTestId("profile-phone-code-sent");
    await user.keyboard("000000");
    const field = screen.getByLabelText("Код из SMS");
    expect(field).toHaveAttribute("readonly");
    expect(field).not.toBeDisabled();
    rejectFirst(new PhoneFailure("invalid"));
    await screen.findByRole("alert");
    expect(field).toHaveFocus();

    await user.keyboard("{Backspace>6/}482913");

    expect(confirm).toHaveBeenLastCalledWith("482913");
    expect(
      await screen.findByTestId("profile-phone-verified"),
    ).toBeInTheDocument();
  });

  it("003 EARS-51: a number confirmed on another account goes through the very same steps — code sent, then the generic wrong-code failure for any code", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        requestCode: vi.fn().mockResolvedValue("code_sent"),
        confirm: vi.fn().mockRejectedValue(new PhoneFailure("invalid")),
      }),
    });

    await requestCodeFor(user, "+79990001122");
    expect(
      await screen.findByTestId("profile-phone-code-sent"),
    ).toBeInTheDocument();
    await user.keyboard("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный код");
  });

  it("003 EARS-47: a limit refusal on the request is the generic throttled message inside the entry, which stays open", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        requestCode: vi.fn().mockRejectedValue(new PhoneFailure("throttled")),
      }),
    });

    await requestCodeFor(user, "+79134028871");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Слишком много попыток",
    );
    expect(screen.getByLabelText("Номер телефона")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("003 EARS-49: leaving the code step shows the number as not confirmed, and «Подтвердить» reopens the entry holding it", async () => {
    const user = userEvent.setup();
    renderCard({
      profile: { ...profile, phone: "+79134028871", phoneVerified: true },
    });

    expect(screen.getByTestId("profile-phone-verified")).toBeInTheDocument();
    await user.click(screen.getByTestId("profile-phone-action"));
    expect(screen.getByLabelText("Номер телефона")).toHaveValue("");
    await user.type(screen.getByLabelText("Номер телефона"), "+79990001122");
    await user.click(screen.getByTestId("profile-phone-send"));
    await screen.findByTestId("profile-phone-code-sent");
    await user.click(screen.getByTestId("profile-phone-back"));

    expect(screen.getByTestId("profile-phone")).toHaveTextContent(
      "+7 999 000-11-22",
    );
    expect(screen.getByTestId("profile-phone-helper")).toHaveTextContent(
      "Не подтверждён",
    );
    expect(screen.queryByTestId("profile-phone-verified")).toBeNull();
    await user.click(screen.getByTestId("profile-phone-action"));
    expect(screen.getByLabelText("Номер телефона")).toHaveValue(
      "+79990001122",
    );
  });

  it("003 EARS-47: «Отмена» before any code was requested returns the row to what it showed", async () => {
    const user = userEvent.setup();
    const { phoneActions } = renderCard();

    await user.click(screen.getByTestId("profile-phone-action"));
    await user.click(screen.getByTestId("profile-phone-cancel"));
    expect(screen.getByTestId("profile-phone")).toHaveTextContent("не указан");
    expect(phoneActions.requestCode).not.toHaveBeenCalled();
  });

  it("003 EARS-51: the account's own confirmed number is a no-op success — no code step, the row shows it confirmed", async () => {
    const user = userEvent.setup();
    renderCard({
      phoneActions: phoneActionsMock({
        requestCode: vi.fn().mockResolvedValue("already_confirmed"),
      }),
    });

    await requestCodeFor(user, "+79134028871");

    expect(
      await screen.findByTestId("profile-phone-verified"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("profile-phone-code-sent")).toBeNull();
  });
});
