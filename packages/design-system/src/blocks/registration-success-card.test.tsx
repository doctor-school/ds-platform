import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RegistrationSuccessCard } from "./registration-success-card";

afterEach(cleanup);

/**
 * `<RegistrationSuccessCard>` (021 EARS-9 + EARS-10, #1546).
 *
 * The block decides nothing, so the harness asserts the three properties a host
 * cannot restore if the block loses them: the RANK of the two actions, the
 * hrefs arriving verbatim from the caller, and the two rows that must be ABSENT
 * rather than empty when the server has nothing to put in them.
 */
const PRIMARY = { href: "/events/prp-pri-gonartroze", label: "Вернуться к эфиру →" };
const SECONDARY = { href: "/account", label: "В личный кабинет" };

function renderCard(props: Record<string, unknown> = {}) {
  return render(
    <RegistrationSuccessCard
      title="Почта подтверждена"
      accrual="Стартовые очки за регистрацию начислим на ваш счёт"
      primary={PRIMARY}
      secondary={SECONDARY}
      {...props}
    />,
  );
}

describe("<RegistrationSuccessCard>", () => {
  it("021 EARS-10: the landing is the first action and the cabinet the second, each on the caller's href", () => {
    renderCard();

    const primary = screen.getByTestId("registration-success-primary");
    const secondary = screen.getByTestId("registration-success-secondary");
    expect(primary).toHaveAttribute("href", "/events/prp-pri-gonartroze");
    expect(secondary).toHaveAttribute("href", "/account");
    // RANK, asserted as document order rather than as styling: the account page
    // is never the default outcome of a confirmation.
    expect(
      primary.compareDocumentPosition(secondary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("021 EARS-10: the secondary action is visually subordinate, not a second filled call to action", () => {
    renderCard();

    const primary = screen.getByTestId("registration-success-primary");
    const secondary = screen.getByTestId("registration-success-secondary");
    expect(primary.className).toContain("bg-primary-action");
    expect(secondary.className).not.toContain("bg-primary-action");
  });

  it("021 EARS-9: the accrual line renders exactly the sentence the host resolved (the pending promise)", () => {
    renderCard();

    expect(screen.getByTestId("registration-success-accrual")).toHaveTextContent(
      "Стартовые очки за регистрацию начислим на ваш счёт",
    );
  });

  it("021 EARS-9: a credited FACT renders in the same row — the block never formats the amount itself", () => {
    renderCard({ accrual: "Вам начислено 20 Pul — стартовые очки за регистрацию." });

    expect(screen.getByTestId("registration-success-accrual")).toHaveTextContent(
      "Вам начислено 20 Pul — стартовые очки за регистрацию.",
    );
  });

  it("021 EARS-9: with no profile-completion line the row is absent from the tree, never an empty frame", () => {
    renderCard();

    expect(screen.queryByTestId("registration-success-profile")).toBeNull();
  });

  it("021 EARS-9: a supplied profile-completion line renders verbatim", () => {
    renderCard({ profileCompletion: "Заполните профиль — ещё 30 Pul." });

    expect(screen.getByTestId("registration-success-profile")).toHaveTextContent(
      "Заполните профиль — ещё 30 Pul.",
    );
  });

  it("021 EARS-10: with nothing degraded there is no reason row", () => {
    renderCard();

    expect(screen.queryByTestId("registration-success-reason")).toBeNull();
  });

  it("021 EARS-10: a degraded landing states what happened, above the actions, as a live status", () => {
    renderCard({
      reason: "Эфир, на который вы записывались, уже завершился — вот его страница.",
    });

    const reason = screen.getByTestId("registration-success-reason");
    expect(reason).toHaveTextContent(
      "Эфир, на который вы записывались, уже завершился — вот его страница.",
    );
    expect(reason).toHaveAttribute("role", "status");
    expect(
      reason.compareDocumentPosition(
        screen.getByTestId("registration-success-primary"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
