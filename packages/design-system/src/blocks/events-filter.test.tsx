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
 * contract the requirement states: the full REQ-138 facet set, every applied
 * facet visible as a removable unit with a working reset and a stated count,
 * and the three D-1 fill states rendering correctly so a consumer mounting
 * fewer facets breaks neither the panel nor the host grid.
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
  nmoOnly: "Только с НМО",
  freeByPul: "Бесплатно по Pul",
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

function group(name: string) {
  return screen.getByRole("group", { name });
}

describe("EventsFilter — the REQ-138 facet set (EARS-7)", () => {
  it("EARS-7.1: renders all seven REQ-138 facets in the `full` fill state", async () => {
    renderPanel();

    // format · kind · specialty · city — grouped facets.
    expect(within(group(LABELS.format)).getByText("Вебинар")).toBeInTheDocument();
    expect(
      within(group(LABELS.format)).getByText("Офлайн-встреча коллег"),
    ).toBeInTheDocument();
    expect(
      within(group(LABELS.kind)).getByText("Doctor Club"),
    ).toBeInTheDocument();
    expect(
      within(group(LABELS.specialty)).getByText(LABELS.specialtyMine),
    ).toBeInTheDocument();
    expect(within(group(LABELS.city)).getByText("Казань")).toBeInTheDocument();
    // НМО · free-by-Pul — boolean facets.
    expect(screen.getByLabelText(LABELS.nmoOnly)).toBeInTheDocument();
    expect(screen.getByLabelText(LABELS.freeByPul)).toBeInTheDocument();
    // name search.
    expect(screen.getByLabelText(LABELS.query)).toBeInTheDocument();
  });

  it("EARS-7.1: the panel is one labelled region — the sidebar the screen mounts beside the body", () => {
    renderPanel();
    expect(
      screen.getByRole("region", { name: LABELS.panel }),
    ).toBeInTheDocument();
  });

  it("EARS-7.1: defaults the specialty facet to «моя и смежные»", () => {
    renderPanel();
    expect(
      within(group(LABELS.specialty)).getByRole("button", {
        name: LABELS.specialtyMine,
        pressed: true,
      }),
    ).toBeInTheDocument();
  });

  it("EARS-7.1: city carries its offline-only hint — the facet does not silently narrow online events", () => {
    renderPanel();
    expect(within(group(LABELS.city)).getByText(LABELS.cityHint)).toBeInTheDocument();
  });
});

describe("EventsFilter — facets apply and combine (EARS-7)", () => {
  it("EARS-7.2: a format selection is emitted as the next applied-facet set", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    await user.click(
      within(group(LABELS.format)).getByRole("button", { name: "Вебинар" }),
    );

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

    await user.click(
      within(group(LABELS.city)).getByRole("button", { name: "Казань" }),
    );

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

    await user.click(
      within(group(LABELS.format)).getByRole("button", { name: "Вебинар" }),
    );

    expect(onChange).toHaveBeenCalledWith({ ...applied, format: ["podcast"] });
  });

  it("EARS-7.2: the boolean facets emit their own flag only", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    await user.click(screen.getByLabelText(LABELS.nmoOnly));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, nmoOnly: true });

    await user.click(screen.getByLabelText(LABELS.freeByPul));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, freeByPul: true });
  });

  it("EARS-7.2: the specialty facet switches scope between «моя и смежные», «все» and explicit ids", async () => {
    const user = userEvent.setup();
    const { onChange, rerender } = renderPanel();

    await user.click(
      within(group(LABELS.specialty)).getByRole("button", {
        name: LABELS.specialtyAll,
      }),
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
    await user.click(
      within(group(LABELS.specialty)).getByRole("button", {
        name: "Травматология",
      }),
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

    expect(group(LABELS.view)).toBeInTheDocument();
    expect(group(LABELS.tense)).toBeInTheDocument();
    for (const absent of [LABELS.format, LABELS.kind, LABELS.specialty, LABELS.city]) {
      expect(
        screen.queryByRole("group", { name: absent }),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(LABELS.nmoOnly)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(LABELS.freeByPul)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(LABELS.query)).not.toBeInTheDocument();
    // Still the same labelled sidebar region — a lighter fill is not a broken panel.
    expect(screen.getByRole("region", { name: LABELS.panel })).toBeInTheDocument();
  });

  it("EARS-7.4: `intermediate` adds format and kind and nothing beyond them", () => {
    renderPanel({ fill: "intermediate" });

    expect(group(LABELS.view)).toBeInTheDocument();
    expect(group(LABELS.tense)).toBeInTheDocument();
    expect(group(LABELS.format)).toBeInTheDocument();
    expect(group(LABELS.kind)).toBeInTheDocument();
    for (const absent of [LABELS.specialty, LABELS.city]) {
      expect(
        screen.queryByRole("group", { name: absent }),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(LABELS.query)).not.toBeInTheDocument();
  });

  it("EARS-7.4: `full` carries every group the lighter states carry, plus the REQ-138 remainder", () => {
    renderPanel();
    for (const present of [
      LABELS.view,
      LABELS.tense,
      LABELS.format,
      LABELS.kind,
      LABELS.specialty,
      LABELS.city,
    ]) {
      expect(group(present)).toBeInTheDocument();
    }
  });

  it("EARS-7.4: a fill state whose options the consumer omits renders no empty group shell", () => {
    renderPanel({ options: { view: OPTIONS.view, tense: OPTIONS.tense } });
    // `full` was asked for, but only two option sets were supplied: the panel
    // drops the group rather than rendering a labelled empty box (LD-9's
    // «empty labelled box is a defect», applied to the panel itself).
    expect(
      screen.queryByRole("group", { name: LABELS.format }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: LABELS.city }),
    ).not.toBeInTheDocument();
    // The facets that need no option list still render at `full`.
    expect(screen.getByLabelText(LABELS.nmoOnly)).toBeInTheDocument();
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
