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
 * rendering (021 EARS-5, F-021-1 «вариант Б»), the LIVE submit whose unmet
 * conditions are reported on their own rows after the press (021 EARS-12, owner
 * Stage-B 2026-09-22), and the form-level statements held apart (003
 * EARS-17/16).
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
  });

  it("#2027: the tier-2 statement carries NO «необязательно» marker — its position says it", () => {
    renderCard();

    // Owner's canvas (`design-source/auth.dc.html:217-225`): the opt-in below
    // the button is a plain statement. The badge used to restate in words what
    // standing outside the access frame already says.
    const marketingGroup = screen.getByTestId("registration-consent-marketing");
    // Nothing beyond the statement itself is rendered on that row.
    expect(marketingGroup.textContent?.trim()).toBe("Send me the newsletter");
  });

  it("021 EARS-12: the submit is LIVE in every state — there is no disabled button on this surface", async () => {
    // Owner's Stage-B verdict (2026-09-22) and canvas 211/490: the button is
    // drawn enabled in every state the canvas has, and the canvas carries no
    // reason line anywhere.
    const user = userEvent.setup();
    renderCard();

    const submit = screen.getByTestId("register-submit");
    expect(submit).toBeEnabled();
    expect(submit).not.toHaveAttribute("aria-describedby");

    await user.click(screen.getByTestId("register-medworker"));
    expect(submit).toBeEnabled();

    await user.click(screen.getByTestId("register-partner-data"));
    expect(submit).toBeEnabled();
  });

  it("021 EARS-12: an ungranted access condition is reported ON ITS OWN ROW after the press, and the command is not run", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCard();

    // Nothing is said before the visitor asks for anything — the conditions are
    // not pre-accused.
    expect(screen.queryByText("Confirm you are a medical worker")).toBeNull();

    await user.type(screen.getByTestId("register-email"), "doctor@clinic.ru");
    await user.type(screen.getByTestId("register-password"), "supersecret1");
    await user.click(screen.getByTestId("register-submit"));

    // BOTH unmet conditions are named at once, each under its own row: the
    // visitor sees everything left to do rather than one obstacle at a time.
    const medRow = screen.getByTestId("register-medworker-item");
    const partnerRow = screen.getByTestId("register-partner-data-item");
    expect(medRow).toHaveTextContent("Confirm you are a medical worker");
    expect(partnerRow).toHaveTextContent("Agree to the partner data transfer");
    expect(onSubmit).not.toHaveBeenCalled();

    // The report is TIED to its control, not merely placed near it: the box is
    // marked invalid and points at the message that explains it.
    const box = screen.getByTestId("register-medworker");
    expect(box).toHaveAttribute("aria-invalid", "true");
    const describedBy = box.getAttribute("aria-describedby") ?? "";
    const message = medRow.querySelector('[role="alert"]');
    expect(message).not.toBeNull();
    expect(describedBy.split(/\s+/)).toContain(message!.id);

    // Granting the condition clears its own report and nothing else.
    await user.click(box);
    expect(medRow).not.toHaveTextContent("Confirm you are a medical worker");
    expect(partnerRow).toHaveTextContent("Agree to the partner data transfer");
  });

  it("021 EARS-6: the optional opt-in is never reported as unmet", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId("register-submit"));

    const marketingGroup = screen.getByTestId("registration-consent-marketing");
    expect(marketingGroup.querySelector('[role="alert"]')).toBeNull();
    expect(screen.getByTestId("register-marketing")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("#2027: the access frame is the canvas frame — no filled heading bar, one uniform padding", () => {
    // Owner Stage-B 2026-09-22: parity is the RENDERING. Canvas 186-187 frames
    // the conditions in the card's own 2px ink border with 16px of padding all
    // round and stands the eyebrow INSIDE that padding as a plain line.
    renderCard();

    const group = screen.getByTestId("registration-consent-access");
    expect(group).toHaveClass("border-2", "border-border", "p-4", "gap-3.5");

    const heading = screen.getByText("Access conditions");
    expect(heading.className).not.toMatch(/\bbg-/);
    expect(heading.className).not.toMatch(/\bborder-b-2\b/);
    // The exact kegel/tracking/tone of that line is the family eyebrow recipe,
    // asserted against the canvas by the `#2027` tone spec below.
    expect(heading).toHaveClass("font-extrabold", "uppercase");
  });

  it("#2027: every consent statement reads at one weight — the opt-in is not spoken more quietly", () => {
    // Canvas 221: the marketing statement is bold ink like any other row. Its
    // optionality is carried by standing BELOW the submit, outside the frame.
    renderCard();

    const marketing = screen.getByText("Send me the newsletter");
    expect(marketing.className ?? "").not.toMatch(/text-muted-foreground/);
  });

  it("021 design §7: the promo field is rendered only when the host supplies the slot", () => {
    renderCard();
    expect(screen.queryByTestId("register-promo")).toBeNull();

    cleanup();
    renderCard({
      promo: {
        label: "Promo code",
        placeholder: "DS-2026",
        testId: "register-promo",
      },
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
      returnContextSlot: (
        <span data-testid="return-context">back to the webinar</span>
      ),
      attributionSlot: (
        <span data-testid="attribution">from a representative</span>
      ),
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
    expect(
      screen.queryByTestId("registration-consent-manager-note"),
    ).toBeNull();
  });

  it("003 EARS-17/16: the challenge and the command statements surface independently, both as alerts", () => {
    renderCard({
      errors: {
        challenge: "The challenge failed",
        command: "The request failed",
      },
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

  it("021 EARS-7: the consent note renders INSIDE the access frame, only when supplied", () => {
    renderCard();
    expect(
      screen.queryByTestId("registration-consent-manager-note"),
    ).toBeNull();

    cleanup();
    renderCard({ consentNote: "You may withdraw a consent at any time" });
    const note = screen.getByTestId("registration-consent-manager-note");
    expect(note).toHaveTextContent("You may withdraw a consent at any time");
    // Owner's canvas (`auth.dc.html:204`) keeps the withdrawal sentence inside
    // the conditions frame, with the consents it speaks about.
    expect(screen.getByTestId("registration-consent-access")).toContainElement(
      note,
    );
  });

  it("021 EARS-7: a card with no access frame still says the withdrawal sentence", () => {
    renderCard({
      consentItems: [MARKETING_ITEM],
      consentNote: "You may withdraw a consent at any time",
    });

    expect(screen.queryByTestId("registration-consent-access")).toBeNull();
    expect(
      screen.getByTestId("registration-consent-manager-note"),
    ).toHaveTextContent("You may withdraw a consent at any time");
  });

  it("003 EARS-20: the statement slot renders AFTER the access frame and before the submit group, only when supplied", () => {
    renderCard();
    expect(screen.queryByTestId("below-fields")).toBeNull();

    cleanup();
    renderCard({
      belowFieldsSlot: <p data-testid="below-fields">Consent statement</p>,
    });
    const slot = screen.getByTestId("below-fields");
    const accessGroup = screen.getByTestId("registration-consent-access");
    const submit = screen.getByTestId("register-submit");
    // `compareDocumentPosition` reads the RENDERED order, which is the whole
    // contract — the owner's canvas (`auth.dc.html:208`) stands the statement
    // between the conditions frame and the challenge on BOTH storefronts.
    expect(
      accessGroup.compareDocumentPosition(slot) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      slot.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("#2027: the partner-link plate renders under the promo field, only when supplied", () => {
    renderCard({ promo: { label: "Promo code" } });
    expect(screen.queryByTestId("partner-plate")).toBeNull();

    cleanup();
    renderCard({
      promo: { label: "Promo code", testId: "register-promo" },
      partnerPlateSlot: <p data-testid="partner-plate">Promo prefilled</p>,
    });
    const plate = screen.getByTestId("partner-plate");
    const promo = screen.getByTestId("register-promo");
    const accessGroup = screen.getByTestId("registration-consent-access");
    // Canvas 176-182: the plate explains the promo field, so it stands inside
    // that row and above the conditions frame.
    expect(
      promo.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      plate.compareDocumentPosition(accessGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("#2027: the access conditions are separated by a hairline rule inside the frame", () => {
    renderCard();

    // Canvas 195 — two wrapping statements must not read as one paragraph.
    const rows = screen
      .getByTestId("registration-consent-access")
      .querySelectorAll("[data-testid$='-item']");
    expect(rows.length).toBe(2);
    expect(rows[0]?.parentElement?.className ?? "").not.toMatch(/border-t-2/);
    expect(rows[1]?.parentElement?.className ?? "").toContain("border-t-2");
  });

  it("021 EARS-5: no consent is ever pre-ticked, and the granted state reaches onSubmit", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCard({
      consentItems: [ACCESS_ITEM, MARKETING_ITEM],
    });

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
    renderCard({
      formDataAttributes: { "data-registration-landing": "webinar" },
    });
    expect(screen.getByTestId("registration-form")).toHaveAttribute(
      "data-registration-landing",
      "webinar",
    );
  });
});

/**
 * #2027 — no credential may ride a URL before hydration.
 *
 * Every auth `<form>` in this package is submitted by a handler that only exists
 * once the bundle has run. A visitor who presses the button before that submits
 * NATIVELY, and a `<form>` with no `method` is a GET: the chosen password and the
 * one-time code go into the query string, the browser history and every access
 * log on the way. `method="post"` moves them into the request body, which is the
 * whole of the fix — the submitted path is unchanged, `action` stays off so the
 * browser uses the current document URL, and the rendered surface is
 * byte-identical, so there is no visual delta to review.
 */
describe("#2027 <RegisterCard> pre-hydration submit", () => {
  it("EARS-17.4: the registration form posts — a native submit never puts the chosen password in the URL", () => {
    const { container } = renderCard();
    const forms = container.querySelectorAll("form");
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form.getAttribute("method")).toBe("post");
    }
  });
});

/**
 * Canvas tone pass (#2027, owner rule 2026-09-22 «parity is the rendering»).
 * `design-source/auth.dc.html` speaks the door's secondary copy in `inkFaint`,
 * not the darker `inkMuted` the block had been reaching for, and it sets three
 * half-step kegels the Tailwind ladder has no rung for: the consent statement at
 * 13.5px, the conditions note at 11.5px, the eyebrow at 11px. The design system
 * now carries all three as named tokens, so the block names the token instead of
 * approximating with the nearest whole step.
 */
describe("#2027 <RegisterCard> canvas tone and kegel", () => {
  it("#2027: the conditions eyebrow speaks at the canvas 11px in the FAINT tone (canvas 187)", () => {
    renderCard();

    const heading = screen.getByText("Access conditions");
    expect(heading).toHaveClass(
      "text-eyebrow",
      "font-extrabold",
      "uppercase",
      "tracking-micro",
      "text-faint",
    );
    expect(heading.className).not.toMatch(/text-muted-foreground/);
  });

  it("#2027: the withdrawal note runs at the canvas 11.5px half-step in the faint tone (canvas 204)", () => {
    renderCard({ consentNote: "You may withdraw a consent at any time" });
    expect(screen.getByTestId("registration-consent-manager-note")).toHaveClass(
      "text-pill",
      "leading-normal",
      "text-faint",
    );

    cleanup();
    // The frameless host (marketing rows only) says the same sentence in the
    // same voice — a second placement is not a second style.
    renderCard({
      consentItems: [MARKETING_ITEM],
      consentNote: "You may withdraw a consent at any time",
    });
    expect(screen.getByTestId("registration-consent-manager-note")).toHaveClass(
      "text-pill",
      "leading-normal",
      "text-faint",
    );
  });

  it("#2027: the reason under a consent statement is faint, not muted (canvas 192/200/222)", () => {
    renderCard({
      consentItems: [
        { ...ACCESS_ITEM, help: "We check the register", helpTestId: "help" },
      ],
    });

    const help = screen.getByTestId("help");
    expect(help).toHaveClass("text-xs", "leading-normal", "text-faint");
    expect(help.className).not.toMatch(/text-muted-foreground/);
  });

  it("#2027: an error-free card draws no banner frame above the glyph (canvas 56-62)", () => {
    renderCard({ icon: <span data-testid="glyph">◆</span> });
    const tile = screen.getByTestId("glyph").parentElement;
    expect(tile?.previousElementSibling).toBeNull();
  });

  it("#2027: a refused command still stands in the banner above the glyph (canvas 56-61)", () => {
    renderCard({
      icon: <span data-testid="glyph">◆</span>,
      errors: { command: "It failed" },
    });
    const tile = screen.getByTestId("glyph").parentElement;
    expect(tile?.previousElementSibling).toHaveTextContent("It failed");
  });

  it("003 EARS-17: the invisible challenge mount stands out of the form's 18px rhythm (canvas 209-211)", () => {
    renderCard({ captchaSlot: <div data-testid="captcha">challenge</div> });
    const mount = screen.getByTestId("captcha").parentElement;
    expect(mount).toHaveClass("absolute");
    expect(mount?.parentElement).toBe(screen.getByTestId("registration-form"));
  });

  it("#2027: the password input carries the host placeholder (canvas 151)", () => {
    renderCard({ copy: { ...COPY, passwordPlaceholder: "••••••••" } });
    expect(screen.getByTestId("register-password")).toHaveAttribute(
      "placeholder",
      "••••••••",
    );
  });
});
