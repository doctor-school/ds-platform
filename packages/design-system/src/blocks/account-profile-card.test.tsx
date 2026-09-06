import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MyProfile } from "@ds/schemas";

import {
  AccountProfileCard,
  type AccountProfileCardCopy,
} from "./account-profile-card";

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
  passwordLabel: "Пароль",
  passwordChange: "Сменить пароль",
  passwordHelper: "Отправим код для сброса пароля на email",
  eventsLabel: "События",
  eventsTitle: "Мои события",
  eventsHelper: "Эфиры, записи и сертификаты",
  signOut: "Выйти из аккаунта",
};

const profile: MyProfile = {
  email: "doctor@example.org",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Анна Сергеева",
};

function renderCard(
  overrides: {
    profile?: MyProfile;
    eventsHref?: string | null;
    passwordHref?: string | null;
    initials?: string | null;
    onSaveDisplayName?: (name: string) => Promise<void>;
    resolveSaveError?: (error: unknown) => string;
    onSignOut?: () => void;
  } = {},
) {
  const onSaveDisplayName =
    overrides.onSaveDisplayName ?? vi.fn().mockResolvedValue(undefined);
  const onSignOut = overrides.onSignOut ?? vi.fn();
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
      onSaveDisplayName={onSaveDisplayName}
      resolveSaveError={overrides.resolveSaveError ?? (() => "mapped-error")}
      onSignOut={onSignOut}
    />,
  );
  return { onSaveDisplayName, onSignOut };
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
});
