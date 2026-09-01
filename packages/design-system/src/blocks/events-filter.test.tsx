import * as React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventsFilter, type AppliedFacets } from "./events-filter";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * 019 EARS-7 — the shared `events-filter` unit (source
 * `design-source/doctor-events.dc.html`, F-019-1 Б sidebar). jsdom pins the
 * contract the requirement states: the full REQ-138 facet set in the canvas
 * control language (closed labelled selects stating their current value, the
 * option sheet on demand), every applied facet visible as a removable unit
 * with a working reset and a stated count, and the three D-1 fill states
 * rendering correctly so a consumer mounting fewer facets breaks neither the
 * panel nor the host grid.
 */

const EMPTY: AppliedFacets = {
  format: [],
  kind: [],
  specialtyScope: "mine-and-adjacent",
  city: [],
  nmoOnly: false,
  freeByPul: false,
  query: "",
};

const OPTIONS = {
  view: [
    { id: "week", label: "Неделя" },
    { id: "month", label: "Месяц" },
  ],
  tense: [
    { id: "upcoming", label: "Будущие" },
    { id: "past", label: "Прошедшие" },
  ],
  format: [
    { id: "webinar", label: "Вебинар" },
    { id: "online-meeting", label: "Онлайн-встреча" },
    { id: "offline-meetup", label: "Офлайн-встреча коллег" },
    { id: "congress", label: "Конгресс" },
    { id: "podcast", label: "Подкаст-эфир" },
  ],
  kind: [
    { id: "case-review", label: "Разбор случая" },
    { id: "club", label: "Doctor Club" },
  ],
  specialty: [
    { id: "traumatology", label: "Травматология" },
    { id: "rheumatology", label: "Ревматология" },
  ],
  city: [
    { id: "kazan", label: "Казань" },
    { id: "moscow", label: "Москва" },
  ],
};

const LABELS = {
  panel: "Фильтры событий",
  view: "Вид",
  tense: "Время",
  format: "Формат",
  kind: "Тип события",
  specialty: "Специальность",
  specialtyMine: "Моя и смежные",
  specialtyAll: "Все специальности",
  city: "Город",
  cityHint: "Город действует на офлайн-события.",
  anyValue: "Все",
  cityAny: "Все города",
  nmoOnly: "Только с НМО",
  nmoFacet: "НМО",
  nmoOff: "Не важно",
  freeByPul: "Бесплатно по Pul",
  freeByPulFacet: "Цена в Pul",
  freeByPulOff: "Любая",
  closeOptions: "Закрыть список",
  query: "Поиск по названию",
  queryPlaceholder: "Поиск по названию",
  applied: "Фильтры:",
  appliedCount: (n: number) => `Применено фильтров: ${n}`,
  removeFacet: "Убрать фильтр",
  reset: "Сбросить фильтры",
};

function renderPanel(
  props: Partial<React.ComponentProps<typeof EventsFilter>> = {},
) {
  const onChange = vi.fn();
  const utils = render(
    <EventsFilter
      fill="full"
      applied={EMPTY}
      appliedCount={0}
      options={OPTIONS}
      labels={LABELS}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, ...utils };
}

/** The CLOSED control of a facet — the canvas language's resting state. */
function facet(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}: `) });
}

function queryFacet(label: string) {
  return screen.queryByRole("button", { name: new RegExp(`^${label}: `) });
}

/** Open a facet's option sheet and return the sheet as its labelled group. */
async function openSheet(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(facet(label));
  return screen.getByRole("group", { name: label });
}

describe("EventsFilter — the REQ-138 facet set (EARS-7)", () => {
  it("EARS-7.1: renders all seven REQ-138 facets in the `full` fill state", () => {
    renderPanel();

    // format · kind · specialty · city — list facets, each a closed control
    // stating its own current value.
    expect(facet(LABELS.format)).toHaveTextContent(LABELS.anyValue);
    expect(facet(LABELS.kind)).toHaveTextContent(LABELS.anyValue);
    expect(facet(LABELS.specialty)).toHaveTextContent(LABELS.specialtyMine);
    expect(facet(LABELS.city)).toHaveTextContent(LABELS.cityAny);
    // НМО · цена в Pul — two-state facets in the same control.
    expect(facet(LABELS.nmoFacet)).toHaveTextContent(LABELS.nmoOff);
    expect(facet(LABELS.freeByPulFacet)).toHaveTextContent(LABELS.freeByPulOff);
    // name search.
    expect(screen.getByLabelText(LABELS.query)).toBeInTheDocument();
  });

  it("EARS-7.1: nothing is expanded by default — the sidebar states its answers, not its option book", () => {
    renderPanel();
    for (const label of [LABELS.format, LABELS.kind, LABELS.specialty, LABELS.city]) {
      expect(screen.queryByRole("group", { name: label })).not.toBeInTheDocument();
      expect(facet(label)).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("EARS-7.1: opening a facet closes the previously open one — one sheet at a time", async () => {
    const user = userEvent.setup();
    renderPanel();

    await openSheet(user, LABELS.format);
    await openSheet(user, LABELS.city);

    expect(
      screen.queryByRole("group", { name: LABELS.format }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: LABELS.city })).toBeInTheDocument();
  });

  it("EARS-7.1: the option sheet closes on its own ✕ without touching the applied set", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    const sheet = await openSheet(user, LABELS.format);
    await user.click(
      within(sheet).getByRole("button", { name: LABELS.closeOptions }),
    );

    expect(
      screen.queryByRole("group", { name: LABELS.format }),
    ).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("EARS-7.1: the panel is one labelled region — the sidebar the screen mounts beside the body", () => {
    renderPanel();
    expect(
      screen.getByRole("region", { name: LABELS.panel }),
    ).toBeInTheDocument();
  });

  it("EARS-7.1: defaults the specialty facet to «моя и смежные»", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(facet(LABELS.specialty)).toHaveTextContent(LABELS.specialtyMine);
    const sheet = await openSheet(user, LABELS.specialty);
    expect(
      within(sheet).getByRole("button", {
        name: LABELS.specialtyMine,
        pressed: true,
      }),
    ).toBeInTheDocument();
  });

  it("EARS-7.1: city carries its offline-only hint — the facet does not silently narrow online events", async () => {
    const user = userEvent.setup();
    renderPanel();
    const sheet = await openSheet(user, LABELS.city);
    expect(within(sheet).getByText(LABELS.cityHint)).toBeInTheDocument();
  });
});

describe("EventsFilter — facets apply and combine (EARS-7)", () => {
  it("EARS-7.2: a format selection is emitted as the next applied-facet set", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    const sheet = await openSheet(user, LABELS.format);
    await user.click(within(sheet).getByRole("button", { name: "Вебинар" }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, format: ["webinar"] });
  });

  it("EARS-7.2: facets COMBINE — a second facet extends the applied set instead of replacing it", async () => {
    const user = userEvent.setup();
    const applied: AppliedFacets = {
      ...EMPTY,
      format: ["webinar"],
      nmoOnly: true,
    };
    const { onChange } = renderPanel({ applied, appliedCount: 2 });

    const sheet = await openSheet(user, LABELS.city);
    await user.click(within(sheet).getByRole("button", { name: "Казань" }));

    expect(onChange).toHaveBeenCalledWith({ ...applied, city: ["kazan"] });
  });

  it("EARS-7.2: a repeatable facet toggles OFF without touching its neighbours", async () => {
    const user = userEvent.setup();
    const applied: AppliedFacets = {
      ...EMPTY,
      format: ["webinar", "podcast"],
      freeByPul: true,
    };
    const { onChange } = renderPanel({ applied, appliedCount: 3 });

    const sheet = await openSheet(user, LABELS.format);
    await user.click(within(sheet).getByRole("button", { name: "Вебинар" }));

    expect(onChange).toHaveBeenCalledWith({ ...applied, format: ["podcast"] });
  });

  it("EARS-7.2: a list facet states its selected values on the closed control", () => {
    renderPanel({
      applied: { ...EMPTY, format: ["webinar", "congress"] },
      appliedCount: 2,
    });
    expect(facet(LABELS.format)).toHaveTextContent("Вебинар, Конгресс");
  });

  it("EARS-7.2: the two-state facets flip on a single click, with no sheet to open", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    await user.click(facet(LABELS.nmoFacet));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, nmoOnly: true });
    expect(
      screen.queryByRole("group", { name: LABELS.nmoFacet }),
    ).not.toBeInTheDocument();

    await user.click(facet(LABELS.freeByPulFacet));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, freeByPul: true });
  });

  it("EARS-7.2: a two-state facet that is ON states its applied value and clears on the next click", async () => {
    const user = userEvent.setup();
    const applied: AppliedFacets = { ...EMPTY, nmoOnly: true };
    const { onChange } = renderPanel({ applied, appliedCount: 1 });

    expect(facet(LABELS.nmoFacet)).toHaveTextContent(LABELS.nmoOnly);
    await user.click(facet(LABELS.nmoFacet));
    expect(onChange).toHaveBeenCalledWith({ ...applied, nmoOnly: false });
  });

  it("EARS-7.2: the specialty facet switches scope between «моя и смежные», «все» and explicit ids", async () => {
    const user = userEvent.setup();
    const { onChange, rerender } = renderPanel();

    let sheet = await openSheet(user, LABELS.specialty);
    await user.click(
      within(sheet).getByRole("button", { name: LABELS.specialtyAll }),
    );
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, specialtyScope: "all" });

    rerender(
      <EventsFilter
        fill="full"
        applied={EMPTY}
        appliedCount={0}
        options={OPTIONS}
        labels={LABELS}
        onChange={onChange}
      />,
    );
    sheet = screen.getByRole("group", { name: LABELS.specialty });
    await user.click(
      within(sheet).getByRole("button", { name: "Травматология" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      specialtyScope: [{ id: "traumatology", label: "Травматология" }],
    });
  });

  it("EARS-7.2: the name search commits once after the typing pause, never per keystroke", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onChange } = renderPanel();

    await user.type(screen.getByLabelText(LABELS.query), "prp");
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, query: "prp" });
    vi.useRealTimers();
  });
});

describe("EventsFilter — applied set, reset and count (EARS-7)", () => {
  const applied: AppliedFacets = {
    format: ["webinar"],
    kind: [],
    specialtyScope: "all",
    city: ["kazan"],
    nmoOnly: true,
    freeByPul: true,
    query: "prp",
  };

  it("EARS-7.3: every applied facet is visible as its own REMOVABLE unit, never a bare count", () => {
    renderPanel({ applied, appliedCount: 6 });
    const row = screen.getByRole("group", { name: LABELS.applied });

    for (const name of [
      "Вебинар",
      LABELS.specialtyAll,
      "Казань",
      LABELS.nmoOnly,
      LABELS.freeByPul,
    ]) {
      expect(
        within(row).getByRole("button", {
          name: `${LABELS.removeFacet}: ${name}`,
        }),
      ).toBeInTheDocument();
    }
    // The free-text query is applied too and is removable on its own.
    expect(within(row).getAllByRole("button")).toHaveLength(6);
  });

  it("EARS-7.3: removing one applied facet leaves the others applied", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({ applied, appliedCount: 6 });

    await user.click(
      screen.getByRole("button", { name: `${LABELS.removeFacet}: Казань` }),
    );

    expect(onChange).toHaveBeenCalledWith({ ...applied, city: [] });
  });

  it("EARS-7.3: the applied count is stated, not merely implied", () => {
    renderPanel({ applied, appliedCount: 6 });
    expect(screen.getByText(LABELS.appliedCount(6))).toBeInTheDocument();
  });

  it("EARS-7.3: reset clears the whole applied set back to the default scope", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderPanel({ applied, appliedCount: 6, onReset });

    await user.click(screen.getByRole("button", { name: LABELS.reset }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("EARS-7.3: a URL-driven consumer gets the reset as a real link (LD-1)", () => {
    renderPanel({ applied, appliedCount: 6, resetHref: "/events" });
    expect(screen.getByRole("link", { name: LABELS.reset })).toHaveAttribute(
      "href",
      "/events",
    );
  });

  it("EARS-7.3: nothing applied — no applied row and no reset affordance is offered", () => {
    renderPanel({ onReset: vi.fn() });
    expect(
      screen.queryByRole("group", { name: LABELS.applied }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: LABELS.reset }),
    ).not.toBeInTheDocument();
  });
});

describe("EventsFilter — the three D-1 fill states (EARS-7)", () => {
  it("EARS-7.4: `wave-1` renders view + tense only — and stays a complete panel", () => {
    renderPanel({ fill: "wave-1" });

    expect(facet(LABELS.view)).toBeInTheDocument();
    expect(facet(LABELS.tense)).toBeInTheDocument();
    for (const absent of [
      LABELS.format,
      LABELS.kind,
      LABELS.specialty,
      LABELS.city,
      LABELS.nmoFacet,
      LABELS.freeByPulFacet,
    ]) {
      expect(queryFacet(absent)).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(LABELS.query)).not.toBeInTheDocument();
    // Still the same labelled sidebar region — a lighter fill is not a broken panel.
    expect(screen.getByRole("region", { name: LABELS.panel })).toBeInTheDocument();
  });

  it("EARS-7.4: `intermediate` adds format and kind and nothing beyond them", () => {
    renderPanel({ fill: "intermediate" });

    expect(facet(LABELS.view)).toBeInTheDocument();
    expect(facet(LABELS.tense)).toBeInTheDocument();
    expect(facet(LABELS.format)).toBeInTheDocument();
    expect(facet(LABELS.kind)).toBeInTheDocument();
    for (const absent of [LABELS.specialty, LABELS.city]) {
      expect(queryFacet(absent)).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(LABELS.query)).not.toBeInTheDocument();
  });

  it("EARS-7.4: `full` carries every facet the lighter states carry, plus the REQ-138 remainder", () => {
    renderPanel();
    for (const present of [
      LABELS.view,
      LABELS.tense,
      LABELS.format,
      LABELS.kind,
      LABELS.specialty,
      LABELS.city,
      LABELS.nmoFacet,
      LABELS.freeByPulFacet,
    ]) {
      expect(facet(present)).toBeInTheDocument();
    }
  });

  it("EARS-7.4: a fill state whose options the consumer omits renders no empty facet control", () => {
    renderPanel({ options: { view: OPTIONS.view, tense: OPTIONS.tense } });
    // `full` was asked for, but only two option sets were supplied: the panel
    // drops the facet rather than offering a control whose sheet is empty
    // (LD-9's «empty labelled box is a defect», applied to the panel itself).
    expect(queryFacet(LABELS.format)).not.toBeInTheDocument();
    expect(queryFacet(LABELS.city)).not.toBeInTheDocument();
    // The facets that need no option list still render at `full`.
    expect(facet(LABELS.nmoFacet)).toBeInTheDocument();
    expect(screen.getByLabelText(LABELS.query)).toBeInTheDocument();
  });

  it("EARS-7.5: the blocks barrel exposes exactly ONE panel implementation — a consumer cannot reach a fork", async () => {
    const barrel = await import("./index");
    // Identity, not shape: a second, forked panel exported under the same name
    // (or the barrel re-pointing at a screen-local copy) fails here, which is
    // what «019 shall create no private copy of the panel» means for a
    // consumer — every mount resolves to this module.
    expect(barrel.EventsFilter).toBe(EventsFilter);
  });

  it("EARS-7.4: the panel owns no width of its own — the host grid places it", () => {
    const { container } = renderPanel();
    const region = screen.getByRole("region", { name: LABELS.panel });
    expect(container.firstChild).toBe(region);
    // No hard-coded sidebar width: the same body is reusable inside #1528's
    // mobile sheet without fighting a baked-in desktop column.
    expect(region.className).not.toMatch(/\bw-\[|\bw-\d|\bmax-w-\[/);
  });
});

describe("EventsFilter — all-selected normalizes to «Все» (EARS-7)", () => {
  it("EARS-7.6: checking the LAST remaining option of a multi-select facet collapses it to the empty set", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: { ...EMPTY, kind: ["case-review"] },
      appliedCount: 1,
    });

    const sheet = await openSheet(user, LABELS.kind);
    await user.click(within(sheet).getByRole("button", { name: "Doctor Club" }));

    // Selecting every option narrows nothing, so the facet drops out of the
    // applied set entirely instead of listing its own whole option book.
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, kind: [] });
  });

  it("EARS-7.6: the collapsed facet shows «Все», carries no chip and adds nothing to the count", () => {
    renderPanel({ applied: { ...EMPTY, kind: [] }, appliedCount: 0 });

    expect(facet(LABELS.kind)).toHaveTextContent(LABELS.anyValue);
    expect(
      screen.queryByRole("group", { name: LABELS.applied }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.appliedCount(0))).not.toBeInTheDocument();
  });

  it("EARS-7.6: naming every offered specialty returns the scope to «моя и смежные»", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: {
        ...EMPTY,
        specialtyScope: [{ id: "traumatology", label: "Травматология" }],
      },
      appliedCount: 1,
    });

    const sheet = await openSheet(user, LABELS.specialty);
    await user.click(within(sheet).getByRole("button", { name: "Ревматология" }));

    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY,
      specialtyScope: "mine-and-adjacent",
    });
  });

  it("EARS-7.6: the sheet gains no «Все» row — the collapse normalizes the value, not the canvas control", async () => {
    const user = userEvent.setup();
    renderPanel();
    const sheet = await openSheet(user, LABELS.format);
    expect(within(sheet).getAllByRole("button")).toHaveLength(
      // five format options + the sheet's own ✕
      OPTIONS.format.length + 1,
    );
  });
});

describe("EventsFilter — the query is committed trimmed (EARS-7)", () => {
  it("EARS-7.7: a whitespace-only input commits as NO query", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onChange } = renderPanel();

    await user.type(screen.getByLabelText(LABELS.query), "   ");
    vi.advanceTimersByTime(400);

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, query: "" });
    vi.useRealTimers();
  });

  it("EARS-7.7: a padded query commits trimmed — the same search as the unpadded one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onChange } = renderPanel();

    await user.type(screen.getByLabelText(LABELS.query), "  prp  ");
    vi.advanceTimersByTime(400);

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, query: "prp" });
    vi.useRealTimers();
  });
});

describe("EventsFilter — the control paints applied only when it applies (EARS-7)", () => {
  it("EARS-7.8: `вид` and `время` read as neutral at their default values — they contribute no chip and no count", () => {
    renderPanel({
      view: { value: "week", onChange: vi.fn() },
      tense: { value: "upcoming", onChange: vi.fn() },
    });

    // The value line of an applied facet carries the accent token; these two
    // never contribute to the applied set, so they must not claim it.
    expect(screen.getByText("Неделя")).toHaveClass("text-foreground");
    expect(screen.getByText("Будущие")).toHaveClass("text-foreground");
    expect(screen.getByText("Неделя")).not.toHaveClass("text-primary-action");
  });

  it("EARS-7.8: a facet that DOES contribute paints applied", () => {
    renderPanel({ applied: { ...EMPTY, city: ["kazan"] }, appliedCount: 1 });
    expect(screen.getByText("Казань", { selector: "span.block" })).toHaveClass(
      "text-primary-action",
    );
  });
});

describe("EventsFilter — the sheet is a disclosure and keeps focus (EARS-7)", () => {
  it("EARS-7.9: Escape closes the open sheet and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    renderPanel();

    await openSheet(user, LABELS.format);
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("group", { name: LABELS.format }),
    ).not.toBeInTheDocument();
    expect(facet(LABELS.format)).toHaveFocus();
  });

  it("EARS-7.9: a click outside the panel closes the open sheet", async () => {
    const user = userEvent.setup();
    renderPanel();
    const outside = document.createElement("button");
    outside.textContent = "снаружи";
    document.body.append(outside);

    await openSheet(user, LABELS.format);
    await user.click(outside);

    expect(
      screen.queryByRole("group", { name: LABELS.format }),
    ).not.toBeInTheDocument();
    outside.remove();
  });

  it("EARS-7.9: closing the sheet on its own ✕ never drops focus to the document", async () => {
    const user = userEvent.setup();
    renderPanel();

    const sheet = await openSheet(user, LABELS.format);
    await user.click(
      within(sheet).getByRole("button", { name: LABELS.closeOptions }),
    );

    expect(document.activeElement).not.toBe(document.body);
    expect(facet(LABELS.format)).toHaveFocus();
  });

  it("EARS-7.9: removing an applied chip moves focus to the next chip, not to the document", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [applied, setApplied] = React.useState<AppliedFacets>({
        ...EMPTY,
        format: ["webinar"],
        city: ["kazan"],
      });
      return (
        <EventsFilter
          fill="full"
          applied={applied}
          appliedCount={2}
          options={OPTIONS}
          labels={LABELS}
          onChange={setApplied}
          onReset={() => setApplied(EMPTY)}
        />
      );
    }
    render(<Harness />);

    await user.click(
      screen.getByRole("button", { name: `${LABELS.removeFacet}: Вебинар` }),
    );

    expect(document.activeElement).not.toBe(document.body);
    expect(
      screen.getByRole("button", { name: `${LABELS.removeFacet}: Казань` }),
    ).toHaveFocus();
  });

  it("EARS-7.9: resetting the whole set lands focus on the panel region, not the document", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [applied, setApplied] = React.useState<AppliedFacets>({
        ...EMPTY,
        format: ["webinar"],
        city: ["kazan"],
      });
      return (
        <EventsFilter
          fill="full"
          applied={applied}
          appliedCount={2}
          options={OPTIONS}
          labels={LABELS}
          onChange={setApplied}
          onReset={() => setApplied(EMPTY)}
        />
      );
    }
    render(<Harness />);

    // The reset control unmounts with the applied block it lives in, so the
    // panel region is the only remaining focus target.
    await user.click(screen.getByRole("button", { name: LABELS.reset }));

    expect(screen.queryByRole("button", { name: LABELS.reset })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("region", { name: LABELS.panel })).toHaveFocus();
  });
});
