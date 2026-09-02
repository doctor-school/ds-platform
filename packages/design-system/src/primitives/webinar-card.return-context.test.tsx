import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WebinarCard } from "./webinar-card";

afterEach(cleanup);

/**
 * 021 EARS-2 (#1538) — the RETURN-CONTEXT reading of the one canonical
 * event-card unit.
 *
 * The doctor registration surface shows the lesson / эфир / ticket the doctor
 * came for in the left half of the auth split. It must be the SAME card the 019
 * feed and the 020 event page render — no screen-local re-implementation and no
 * second card built for this surface (EARS-2) — but with **no back-navigation
 * control on that card**: the owner's explicit condition on the Stage-A pick
 * F-021-2 Б («на карточке не должно быть кнопки, которая уводит назад — это
 * странный UX»), and an invariant of the requirements («The return context card
 * carries no back-navigation control»).
 *
 * That is what `navigable={false}` buys, and these tests pin it as a property of
 * the whole card SUBTREE rather than of any one element: the invariant is "no
 * way out of the form exists here", so the assertion is a count of zero `a` and
 * zero `button` descendants, which no future addition to the card can satisfy
 * accidentally. The default (navigable) reading is asserted alongside so the
 * suppression can never silently become the card's behaviour everywhere.
 *
 * Kept in its own file rather than folded into `webinar-card.test.tsx` because
 * it is a different feature's contract on the shared unit (021, not 004): the
 * 004 file states what the listing card shows, this one states what the return
 * context must NOT offer.
 */

const BASE = {
  time: "19:00",
  tzLabel: "МСК",
  dateLabel: "27 августа · чт",
  school: "Школа ортобиологии",
  title: "PRP при гонартрозе: показания, протоколы, ошибки",
  speakers: [{ name: "Анна Соколова" }],
} as const;

describe("WebinarCard — 021 EARS-2 return context", () => {
  it("021 EARS-2: a non-navigable card renders no link and no button anywhere in its subtree", () => {
    const { container } = render(
      <WebinarCard
        {...BASE}
        navigable={false}
        // Every affordance the card can carry is supplied at once: if any of
        // them leaked through, this is the render that would show it.
        ctaHref="/webinars/prp-gonartroz/room"
        ctaLabel="Войти в эфир"
        live
        liveLabel="В эфире"
      />,
    );

    const card = container.querySelector("[data-webinar-card]");
    expect(card).not.toBeNull();
    expect(card!.querySelectorAll("a")).toHaveLength(0);
    expect(card!.querySelectorAll("button")).toHaveLength(0);
  });

  it("021 EARS-2: the non-navigable card still states plainly what the doctor will return to", () => {
    render(<WebinarCard {...BASE} navigable={false} />);

    // The content contract is unchanged — suppressing the affordance must not
    // suppress the identity of the event, or the card stops being the return
    // context it is there to be.
    expect(
      screen.getByText("PRP при гонартрозе: показания, протоколы, ошибки"),
    ).toBeInTheDocument();
    expect(screen.getByText("Школа ортобиологии")).toBeInTheDocument();
    expect(screen.getByText("19:00")).toBeInTheDocument();
    expect(screen.getByText("27 августа · чт")).toBeInTheDocument();
  });

  it("021 EARS-2: the default card stays navigable — the title is still the stretched event-page link", () => {
    render(<WebinarCard {...BASE} href="/webinars/prp-gonartroz" />);

    const link = screen.getByRole("link", {
      name: "PRP при гонартрозе: показания, протоколы, ошибки",
    });
    expect(link).toHaveAttribute("href", "/webinars/prp-gonartroz");
  });
});
