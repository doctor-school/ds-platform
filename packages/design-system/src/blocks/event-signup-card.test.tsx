import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ParticipationCta } from "@ds/schemas";

import { EventSignupCard } from "./event-signup-card";

afterEach(cleanup);

const cta = (over: Partial<ParticipationCta> = {}): ParticipationCta => ({
  action: "register",
  label: "Участвовать",
  href: "/register",
  reason: null,
  ...over,
});

const base = {
  timeLabel: "19:00",
  dateLabel: "28 августа",
  weekdayLabel: "пятница · МСК",
};

describe("<EventSignupCard>", () => {
  it("020 EARS-1: the card shall render the server-resolved CTA as given, branching on nothing", () => {
    render(
      <EventSignupCard
        {...base}
        conditions={[
          { label: "Участие", value: "Бесплатно для врача" },
          { label: "Длительность", value: "90 минут" },
        ]}
        cta={cta()}
        note="Нужна регистрация — вернём вас на эту страницу."
      />,
    );

    const link = screen.getByTestId("event-signup-cta");
    expect(link).toHaveAttribute("href", "/register");
    expect(link).toHaveTextContent("Участвовать");
    expect(screen.getByTestId("event-signup-card")).toHaveAttribute(
      "data-cta-action",
      "register",
    );
    expect(screen.getByText("Бесплатно для врача")).toBeInTheDocument();
    expect(
      screen.getByText("Нужна регистрация — вернём вас на эту страницу."),
    ).toBeInTheDocument();
  });

  it("020 EARS-1: a switch-to-online CTA shall keep the control AND state the reason", () => {
    render(
      <EventSignupCard
        {...base}
        cta={cta({
          action: "switch-to-online",
          label: "Смотреть онлайн",
          href: "/online",
          reason: "Очные места закончились.",
        })}
      />,
    );

    expect(screen.getByTestId("event-signup-cta")).toHaveAttribute(
      "href",
      "/online",
    );
    expect(screen.getByTestId("event-signup-reason")).toHaveTextContent(
      "Очные места закончились.",
    );
  });

  it.each([
    ["sold-out", "Мест не осталось"],
    ["unavailable", "Участие закрыто"],
  ] as const)(
    "020 EARS-4: %s shall dead-end in words with NO control rather than a disabled one",
    (action, label) => {
      render(
        <EventSignupCard
          {...base}
          cta={cta({
            action,
            label,
            href: null,
            reason: "Регистрация закрыта.",
          })}
        />,
      );

      expect(screen.queryByTestId("event-signup-cta")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByTestId("event-signup-statement")).toHaveTextContent(
        label,
      );
      expect(screen.getByTestId("event-signup-reason")).toHaveTextContent(
        "Регистрация закрыта.",
      );
    },
  );

  it("020 EARS-4: enter-room without a resolved room shall render NO control at all", () => {
    render(
      <EventSignupCard
        {...base}
        cta={cta({ action: "enter-room", label: "Войти в эфир", href: null })}
      />,
    );

    expect(screen.queryByTestId("event-signup-cta")).toBeNull();
    expect(screen.queryByTestId("event-signup-statement")).toBeNull();
  });

  it("020 EARS-4: enter-room WITH a room shall render the control that leads to it", () => {
    render(
      <EventSignupCard
        {...base}
        cta={cta({
          action: "enter-room",
          label: "Войти в эфир",
          href: "/room/42",
        })}
      />,
    );

    expect(screen.getByTestId("event-signup-cta")).toHaveAttribute(
      "href",
      "/room/42",
    );
  });

  it("020 EARS-1: registered shall state the fact when it leads nowhere", () => {
    render(
      <EventSignupCard
        {...base}
        cta={cta({ action: "registered", label: "Вы записаны", href: null })}
      />,
    );

    expect(screen.getByTestId("event-signup-statement")).toHaveTextContent(
      "Вы записаны",
    );
    expect(screen.queryByTestId("event-signup-cta")).toBeNull();
  });

  it("020 EARS-1: pinning shall stick the card on the wide canvas only", () => {
    const { rerender } = render(<EventSignupCard {...base} cta={cta()} pinned />);
    expect(screen.getByTestId("event-signup-card").className).toContain(
      "layout:sticky",
    );

    rerender(<EventSignupCard {...base} cta={cta()} pinned={false} />);
    expect(screen.getByTestId("event-signup-card").className).not.toContain(
      "sticky",
    );
  });

  it("020 EARS-3: the social-proof slot shall stay absent until a host fills it", () => {
    const { rerender } = render(<EventSignupCard {...base} cta={cta()} />);
    expect(screen.queryByTestId("event-signup-proof")).toBeNull();

    rerender(
      <EventSignupCard
        {...base}
        cta={cta()}
        proof={<span>Уже записались 37</span>}
      />,
    );
    expect(screen.getByTestId("event-signup-proof")).toHaveTextContent(
      "Уже записались 37",
    );
  });

  it("020 EARS-1: the host control shall replace the generated link only where the policy already opened one", () => {
    render(
      <EventSignupCard
        {...base}
        cta={cta()}
        control={
          <button type="button" data-testid="host-control">
            Участвовать
          </button>
        }
      />,
    );

    // The host's own element stands in for the generated <a>; the branch is the
    // same one the server policy opened, so exactly ONE control renders.
    expect(screen.getByTestId("host-control")).toBeInTheDocument();
    expect(screen.queryByTestId("event-signup-cta")).toBeNull();
    expect(screen.getByTestId("event-signup-card")).toHaveAttribute(
      "data-cta-action",
      "register",
    );
  });

  it("020 EARS-1: the host control shall be ignored wherever the policy opened no branch — it can never put participation where the server said there is none", () => {
    const closed: ParticipationCta[] = [
      { action: "sold-out", label: "Мест нет", href: null, reason: null },
      {
        action: "unavailable",
        label: "Участие недоступно",
        href: null,
        reason: "Событие завершилось",
      },
      { action: "enter-room", label: "Войти в эфир", href: null, reason: null },
    ];

    for (const closedCta of closed) {
      cleanup();
      render(
        <EventSignupCard
          {...base}
          cta={closedCta}
          control={
            <button type="button" data-testid="host-control">
              Участвовать
            </button>
          }
        />,
      );

      expect(
        screen.queryByTestId("host-control"),
        `must stay absent for: ${closedCta.action}`,
      ).toBeNull();
      expect(screen.queryByTestId("event-signup-cta")).toBeNull();
    }
  });
});
