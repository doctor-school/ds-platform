import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegisterCard, type RegisterCardProps } from "./register-card";

afterEach(cleanup);

/**
 * `<RegisterCard>` (#1934) — the ONE registration form both the Academy
 * `/register` and the doctor storefront door project. The block owns no copy and
 * no transport, so the harness passes plain markers and asserts on the STRUCTURE
 * the two hosts' shipped e2e depend on: the two consent tiers told apart by their
 * rendering (021 EARS-5, F-021-1 «вариант Б»), the stated reason beside a disabled
 * submit (021 EARS-12), and the form-level statements held apart (003 EARS-17/16).
 */

const COPY: RegisterCardProps["copy"] = {
  title: "Registration",
  emailLabel: "Work email",
  passwordLabel: "Password",
  submit: "Register",
  accessGroupHeading: "Access conditions",
};

const ACCESS_ITEM = {
  id: "medicalWorkerDeclaration",
  tier: "access" as const,
  label: "I am a medical worker",
  unmetMessage: "Confirm you are a medical worker",
  testId: "register-medworker",
  itemTestId: "register-medworker-item",
};

const PARTNER_ITEM = {
  id: "partnerDataSharing",
  tier: "access" as const,
  label: "I agree to the partner data transfer",
  unmetMessage: "Agree to the partner data transfer",
  testId: "register-partner-data",
  itemTestId: "register-partner-data-item",
};

const MARKETING_ITEM = {
  id: "marketingCommunications",
  tier: "marketing" as const,
  label: "Send me the newsletter",
  optionalTag: "optional",
  testId: "register-marketing",
  itemTestId: "register-marketing-item",
};

function renderCard(overrides: Partial<RegisterCardProps> = {}) {
  const onSubmit = vi.fn();
  const props: RegisterCardProps = {
    copy: COPY,
    onSubmit,
    consentItems: [ACCESS_ITEM, PARTNER_ITEM, MARKETING_ITEM],
    testIds: {
      root: "registration-screen",
      form: "registration-form",
      email: "register-email",
      password: "register-password",
      submit: "register-submit",
      submitReason: "register-submit-reason",
      challengeError: "register-captcha-error",
      commandError: "register-command-error",
      accessGroup: "registration-consent-access",
      marketingGroup: "registration-consent-marketing",
      note: "registration-consent-manager-note",
    },
    ...overrides,
  };
  return { onSubmit, ...render(<RegisterCard {...props} />) };
}

describe("<RegisterCard>", () => {
  it("021 EARS-5: renders the access tier in the supplied order inside the bordered group above the submit", () => {
    renderCard();

    const group = screen.getByTestId("registration-consent-access");
    expect(group.className).toContain("border-2");
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveTextContent("Access conditions");

    // Supplied order is the rendered order — the host owns the sequence.
    const rows = [
      screen.getByTestId("register-medworker-item"),
      screen.getByTestId("register-partner-data-item"),
    ];
    rows.forEach((row) => expect(group).toContainElement(row));
    expect(
      rows[0]!.compareDocumentPosition(rows[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The group stands ABOVE the submit control it gates.
    const submit = screen.getByTestId("register-submit");
    expect(
      group.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("021 EARS-5: renders the marketing tier below the submit and OUTSIDE the access group", () => {
    renderCard();

    const accessGroup = screen.getByTestId("registration-consent-access");
    const marketingGroup = screen.getByTestId("registration-consent-marketing");
    const submit = screen.getByTestId("register-submit");

    expect(accessGroup).not.toContainElement(marketingGroup);
    expect(marketingGroup).toContainElement(
      screen.getByTestId("register-marketing-item"),
    );
    expect(
      submit.compareDocumentPosition(marketingGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(marketingGroup).toHaveTextContent("optional");
  });

  it("021 EARS-12: the submit stays disabled with the SPECIFIC unmet reason until every access item is granted", async () => {
    const user = userEvent.setup();
    renderCard();

    const submit = screen.getByTestId("register-submit");
    expect(submit).toBeDisabled();
    // The FIRST unmet condition, in the order it is read on screen.
    expect(screen.getByTestId("register-submit-reason")).toHaveTextContent(
      "Confirm you are a medical worker",
    );
    expect(submit).toHaveAttribute(
      "aria-describedby",
      screen.getByTestId("register-submit-reason").id,
    );

    await user.click(screen.getByTestId("register-medworker"));
    expect(submit).toBeDisabled();
    expect(screen.getByTestId("register-submit-reason")).toHaveTextContent(
      "Agree to the partner data transfer",
    );

    await user.click(screen.getByTestId("register-partner-data"));
    expect(submit).toBeEnabled();
    // Honest-empty (021 EARS-3): the paragraph is ABSENT, not empty.
    expect(screen.queryByTestId("register-submit-reason")).toBeNull();
  });

  it("021 EARS-12: states the host precondition once every rendered item is granted", async () => {
    const user = userEvent.setup();
    renderCard({
      consentItems: [ACCESS_ITEM],
      unmetPrecondition: "Registration is temporarily unavailable",
    });

    expect(screen.getByTestId("register-submit-reason")).toHaveTextContent(
      "Confirm you are a medical worker",
    );
    await user.click(screen.getByTestId("register-medworker"));
    expect(screen.getByTestId("register-submit-reason")).toHaveTextContent(
      "Registration is temporarily unavailable",
    );
    expect(screen.getByTestId("register-submit")).toBeDisabled();
  });

  it("021 design §7: the promo field is rendered only when the host supplies the slot", () => {
    renderCard();
    expect(screen.queryByTestId("register-promo")).toBeNull();

    cleanup();
    renderCard({
      promo: { label: "Promo code", placeholder: "DS-2026", testId: "register-promo" },
    });
    expect(screen.getByTestId("register-promo")).toHaveAttribute(
      "placeholder",
      "DS-2026",
    );
  });

  it("003 EARS-17: the captcha slot is optional and renders inside the submit group when supplied", () => {
    renderCard();
    expect(screen.queryByTestId("captcha")).toBeNull();

    cleanup();
    renderCard({ captchaSlot: <div data-testid="captcha">challenge</div> });
    expect(screen.getByTestId("captcha")).toBeInTheDocument();
  });

  it("021 EARS-2 / EARS-3: the return-context and attribution slots render only when supplied", () => {
    renderCard();
    expect(screen.queryByTestId("return-context")).toBeNull();
    expect(screen.queryByTestId("attribution")).toBeNull();

    cleanup();
    renderCard({
      returnContextSlot: <span data-testid="return-context">back to the webinar</span>,
      attributionSlot: <span data-testid="attribution">from a representative</span>,
    });
    expect(screen.getByTestId("return-context")).toBeInTheDocument();
    expect(screen.getByTestId("attribution")).toBeInTheDocument();
  });

  it("003 EARS-16: a supplied confirmation replaces the WHOLE form, surroundings included", () => {
    renderCard({
      confirmation: <div data-testid="confirmation">check your inbox</div>,
      consentNote: "You may withdraw a consent at any time",
      returnContextSlot: <span data-testid="return-context">back</span>,
    });

    expect(screen.getByTestId("confirmation")).toBeInTheDocument();
    expect(screen.queryByTestId("registration-form")).toBeNull();
    expect(screen.queryByTestId("register-submit")).toBeNull();
    expect(screen.queryByTestId("return-context")).toBeNull();
    expect(screen.queryByTestId("registration-consent-manager-note")).toBeNull();
  });

  it("003 EARS-17/16: the challenge and the command statements surface independently, both as alerts", () => {
    renderCard({
      errors: { challenge: "The challenge failed", command: "The request failed" },
    });

    // Held apart on purpose — a fresh challenge must not erase a command failure
    // the visitor still has to read.
    const challenge = screen.getByTestId("register-captcha-error");
    const command = screen.getByTestId("register-command-error");
    expect(challenge).toHaveTextContent("The challenge failed");
    expect(command).toHaveTextContent("The request failed");
    expect(challenge).toHaveAttribute("role", "alert");
    expect(command).toHaveAttribute("role", "alert");
  });

  it("021 EARS-7: the consent note renders below the form only when supplied", () => {
    renderCard();
    expect(screen.queryByTestId("registration-consent-manager-note")).toBeNull();

    cleanup();
    renderCard({ consentNote: "You may withdraw a consent at any time" });
    expect(
      screen.getByTestId("registration-consent-manager-note"),
    ).toHaveTextContent("You may withdraw a consent at any time");
  });

  it("003 EARS-20: the below-fields slot renders between the credentials and the consent/submit groups, only when supplied", () => {
    renderCard();
    expect(screen.queryByTestId("below-fields")).toBeNull();

    cleanup();
    renderCard({
      belowFieldsSlot: <p data-testid="below-fields">Consent statement</p>,
    });
    const slot = screen.getByTestId("below-fields");
    const password = screen.getByTestId("register-password");
    const accessGroup = screen.getByTestId("registration-consent-access");
    // `compareDocumentPosition` reads the RENDERED order, which is the whole
    // contract: the Academy statement has shipped under the credentials and above
    // the challenge, and that position may not drift with a refactor.
    expect(
      password.compareDocumentPosition(slot) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      slot.compareDocumentPosition(accessGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("021 EARS-5: no consent is ever pre-ticked, and the granted state reaches onSubmit", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCard({ consentItems: [ACCESS_ITEM, MARKETING_ITEM] });

    expect(screen.getByTestId("register-medworker")).not.toBeChecked();
    expect(screen.getByTestId("register-marketing")).not.toBeChecked();

    await user.type(screen.getByTestId("register-email"), "doctor@clinic.ru");
    await user.type(screen.getByTestId("register-password"), "correct horse 8");
    await user.click(screen.getByTestId("register-medworker"));
    await user.click(screen.getByTestId("register-marketing"));
    await user.click(screen.getByTestId("register-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      email: "doctor@clinic.ru",
      consents: {
        medicalWorkerDeclaration: true,
        marketingCommunications: true,
      },
    });
  });

  it("003 EARS-38: the password field's reveal toggle renders with the host's supplied labels", async () => {
    const user = userEvent.setup();
    renderCard({
      copy: {
        ...COPY,
        passwordRevealLabels: {
          show: "Show",
          hide: "Hide",
          showAria: "Show the password",
          hideAria: "Hide the password",
        },
      },
    });

    const input = screen.getByTestId("register-password");
    const toggle = screen.getByTestId("register-password-reveal");

    // The control is the primitive's; the block only carries the labels down.
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveTextContent("Show");
    expect(toggle).toHaveAttribute("aria-label", "Show the password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveTextContent("Hide");
    expect(toggle).toHaveAttribute("aria-label", "Hide the password");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("publishes the host data-* facts on the form element (021 EARS-3 landing decision)", () => {
    renderCard({ formDataAttributes: { "data-registration-landing": "webinar" } });
    expect(screen.getByTestId("registration-form")).toHaveAttribute(
      "data-registration-landing",
      "webinar",
    );
  });
});
