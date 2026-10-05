import * as React from "react";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  EventsFilter,
  countAppliedFacets,
  defaultAppliedFacets,
  type AppliedFacets,
  type EventsFilterLabels,
  type EventsFilterOptions,
} from "./events-filter";
// The whole blocks barrel, loaded at collection time: EARS-7.5 asserts export
// IDENTITY, not import speed — a cold barrel import inside the 5 s per-test
// budget timed out on CI once the barrel grew (#1981).
import * as blocksBarrel from "./index";

/**
 * 019 EARS-7 / EARS-13 as amended 2026-10-05 — the shared `events-filter`
 * unit, source `design-source/events-facets.dc.html`. The facet SET is the
 * host's (019 «Differences between storefronts» `filterSet`): the doctor
 * storefront mounts name search, specialty, format, kind, city, «Только с
 * НМО» and direction; the Academy mounts project, expert and topic. The
 * header states «Фильтры», the applied count and «Сбросить» only while
 * something is applied, and `showHeader={false}` yields the bare body the
 * mobile sheet hosts under its own header.
 *
 * jsdom lacks the two browser APIs the Combobox's Radix popper and `cmdk`
 * need — `ResizeObserver` and `scrollIntoView` — so the harness supplies them.
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const EMPTY: AppliedFacets = defaultAppliedFacets();

const OPTIONS: EventsFilterOptions = {
  format: [
    { id: "online", label: "Онлайн" },
    { id: "offline", label: "Офлайн" },
    { id: "hybrid", label: "Гибрид" },
  ],
  kind: [
    { id: "webinar", label: "Вебинар" },
    { id: "congress", label: "Конгресс" },
    { id: "club", label: "Встреча клуба" },
  ],
  specialty: [
    { id: "traumatology", label: "Травматология" },
    { id: "rheumatology", label: "Ревматология" },
  ],
  city: [
    { id: "kazan", label: "Казань" },
    { id: "moscow", label: "Москва" },
  ],
  direction: [
    { id: "sports", label: "Спортивная медицина" },
    { id: "rehab", label: "Реабилитация" },
  ],
  project: [
    { id: "producers", label: "Школа продюсеров" },
    { id: "metrics", label: "Метрики" },
  ],
  expert: [
    { id: "ivanova", label: "Иванова Анна" },
    { id: "petrov", label: "Петров Илья" },
  ],
  topic: [
    { id: "funnels", label: "Воронки" },
    { id: "retention", label: "Удержание" },
  ],
};

const combo = (label: string, one: string, more: string, search: string) => ({
  label,
  placeholder: one,
  addPlaceholder: more,
  searchPlaceholder: search,
});

const LABELS: EventsFilterLabels = {
  panel: "Фильтры",
  title: "Фильтры",
  appliedCount: (n: number) => `Применено: ${n}`,
  reset: "Сбросить",
  removeFacet: "Убрать",
  combobox: {
    emptyLabel: "Ничего не найдено",
    searchLabel: "Найти",
    countLabel: (s: number, t: number) => `Найдено ${s} из ${t}`,
    loadMoreLabel: "Показать ещё",
    loadingMoreLabel: "Загружаем…",
    loadMoreErrorLabel: "Повторить",
  },
  query: { label: "Поиск по названию", placeholder: "Например, PRP" },
  specialty: {
    ...combo(
      "Специальность",
      "Выбрать специальность",
      "Добавить специальность",
      "Например, кардиология",
    ),
    mine: "Моя и смежные",
    all: "Все специальности",
  },
  format: "Формат",
  kind: "Вид события",
  city: {
    ...combo("Город", "Любой город", "Добавить город", "Начните вводить город"),
    hint: "Только для офлайн-событий",
  },
  nmoOnly: "Только с НМО",
  direction: combo(
    "Направление",
    "Все направления",
    "Добавить направление",
    "Например, реабилитация",
  ),
  project: combo(
    "Проект",
    "Все проекты",
    "Добавить проект",
    "Например, школа продюсеров",
  ),
  expert: combo(
    "Эксперт",
    "Все эксперты",
    "Добавить эксперта",
    "Фамилия или имя",
  ),
  topic: combo("Тема", "Все темы", "Добавить тему", "Например, метрики"),
};

function renderPanel(
  props: Partial<React.ComponentProps<typeof EventsFilter>> = {},
) {
  const onChange = vi.fn();
  const utils = render(
    <EventsFilter
      host="doctor"
      applied={EMPTY}
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

/** Wait for the Combobox panel's Radix unmount to settle (#441 orphan timers). */
async function settlePanel() {
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
}

describe("EventsFilter — the doctor facet set (EARS-7, filterSet)", () => {
  it("EARS-7.1: the doctor host renders search, specialty, format, kind, city, НМО and direction — in the canvas order", () => {
    renderPanel();
    expect(screen.getByLabelText("Поиск по названию")).toHaveAttribute(
      "placeholder",
      "Например, PRP",
    );
    const order = [
      "Специальность",
      "Формат",
      "Вид события",
      "Город",
      "Направление",
    ].map((name) => group(name));
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(
      screen.getByRole("switch", { name: "Только с НМО" }),
    ).not.toBeChecked();
  });

  it("EARS-7.1: the doctor set carries no Academy group and no free-by-Pul facet", () => {
    renderPanel();
    for (const name of ["Проект", "Эксперт", "Тема"]) {
      expect(screen.queryByRole("group", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Pul/)).not.toBeInTheDocument();
  });

  it("EARS-7.1: specialty defaults to «Моя и смежные» beside «Все специальности» and a combobox", () => {
    renderPanel();
    const specialty = group("Специальность");
    expect(
      within(specialty).getByRole("button", { name: "Моя и смежные" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(specialty).getByRole("button", { name: "Все специальности" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(specialty).getByRole("combobox", {
        name: /Выбрать специальность/,
      }),
    ).toBeInTheDocument();
  });

  it("EARS-7.1: city states its offline-only hint", () => {
    renderPanel();
    expect(
      within(group("Город")).getByText("Только для офлайн-событий"),
    ).toBeInTheDocument();
  });

  it("EARS-7.1: format and kind are multi-select chips that combine with the applied set", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: { ...EMPTY, kind: ["webinar"] },
    });
    await user.click(
      within(group("Формат")).getByRole("button", { name: "Офлайн" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      kind: ["webinar"],
      format: ["offline"],
    });
    await user.click(
      within(group("Вид события")).getByRole("button", { name: "Вебинар" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, kind: [] });
  });

  it("EARS-7.1: «Все специальности» switches the scope", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Все специальности" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      specialtyScope: "all",
    });
  });

  it("EARS-7.1: picking a specialty in the combobox replaces the scope with that list", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: { ...EMPTY, specialtyScope: "all" },
    });
    await user.click(within(group("Специальность")).getByRole("combobox"));
    await user.click(
      await screen.findByRole("option", { name: "Ревматология" }),
    );
    await settlePanel();
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      specialtyScope: [{ id: "rheumatology", label: "Ревматология" }],
    });
  });

  it("EARS-7.1: picked specialties show as removable chips; removing the last returns to «Моя и смежные»", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: {
        ...EMPTY,
        specialtyScope: [{ id: "traumatology", label: "Травматология" }],
      },
    });
    const specialty = group("Специальность");
    // A picked list selects neither scope chip and re-labels the combobox.
    expect(
      within(specialty).getByRole("button", { name: "Моя и смежные" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(specialty).getByRole("combobox", {
        name: /Добавить специальность/,
      }),
    ).toBeInTheDocument();
    await user.click(
      within(specialty).getByRole("button", { name: "Убрать: Травматология" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      specialtyScope: "mine-and-adjacent",
    });
  });

  it("EARS-7.1: the combobox never offers a value that is already picked", async () => {
    const user = userEvent.setup();
    renderPanel({ applied: { ...EMPTY, city: ["kazan"] } });
    await user.click(within(group("Город")).getByRole("combobox"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Москва"]);
    await user.keyboard("{Escape}");
    await settlePanel();
  });

  it("EARS-7.1: a picked city appends to the applied cities and shows as a removable chip", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: { ...EMPTY, city: ["kazan"] },
    });
    // The canvas draws the chip as «label  ✕» — the cross set off by a space.
    expect(
      within(group("Город")).getByRole("button", { name: "Убрать: Казань" }),
    ).toHaveTextContent(/^Казань ✕$/);
    await user.click(within(group("Город")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Москва" }));
    await settlePanel();
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      city: ["kazan", "moscow"],
    });
  });

  it("EARS-7.1: «Направление» is a combobox group with removable chips on the doctor set", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      applied: { ...EMPTY, direction: ["sports", "rehab"] },
    });
    const direction = group("Направление");
    expect(
      within(direction).getByRole("combobox", {
        name: /Добавить направление/,
      }),
    ).toBeInTheDocument();
    await user.click(
      within(direction).getByRole("button", {
        name: "Убрать: Спортивная медицина",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      direction: ["rehab"],
    });
  });

  it("EARS-7.1: the НМО switch emits nmoOnly", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();
    await user.click(screen.getByRole("switch", { name: "Только с НМО" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, nmoOnly: true });
  });

  it("EARS-7.2: the name search commits once, trimmed, after the typing pause", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onChange } = renderPanel();
    await user.type(screen.getByLabelText("Поиск по названию"), " PRP ");
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, query: "PRP" });
  });

  it("EARS-7.2: the city combobox forwards the host's paging bridge", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    renderPanel({ paging: { city: { hasMore: true, onLoadMore } } });
    await user.click(within(group("Город")).getByRole("combobox"));
    await user.click(
      await screen.findByRole("button", { name: "Показать ещё" }),
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    await settlePanel();
  });
});

describe("EventsFilter — the Academy facet set (EARS-7, filterSet)", () => {
  it("EARS-7.3: the Academy host renders «Проект», «Эксперт», «Тема» and nothing of the doctor set", () => {
    renderPanel({ host: "academy" });
    for (const [name, placeholder] of [
      ["Проект", "Все проекты"],
      ["Эксперт", "Все эксперты"],
      ["Тема", "Все темы"],
    ] as const) {
      expect(
        within(group(name)).getByRole("combobox", {
          name: new RegExp(placeholder),
        }),
      ).toBeInTheDocument();
    }
    for (const name of [
      "Специальность",
      "Формат",
      "Вид события",
      "Город",
      "Направление",
    ]) {
      expect(screen.queryByRole("group", { name })).not.toBeInTheDocument();
    }
    expect(
      screen.queryByLabelText("Поиск по названию"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("EARS-7.3: an Academy pick appends to its own key and shows as a removable chip", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel({
      host: "academy",
      applied: { ...EMPTY, expert: ["petrov"] },
    });
    expect(
      within(group("Эксперт")).getByRole("combobox", {
        name: /Добавить эксперта/,
      }),
    ).toBeInTheDocument();
    await user.click(within(group("Тема")).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Воронки" }));
    await settlePanel();
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      expert: ["petrov"],
      topic: ["funnels"],
    });
    await user.click(
      within(group("Эксперт")).getByRole("button", {
        name: "Убрать: Петров Илья",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, expert: [] });
  });
});

describe("EventsFilter — header, applied count and reset (EARS-7)", () => {
  it("EARS-7.4: nothing applied — the header states «Фильтры» with no count and no reset", () => {
    renderPanel();
    expect(
      screen.getByRole("heading", { name: "Фильтры" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Применено/)).not.toBeInTheDocument();
    expect(screen.queryByText("Сбросить")).not.toBeInTheDocument();
  });

  it("EARS-7.4: the applied count is stated in the header", () => {
    renderPanel({
      applied: {
        ...EMPTY,
        format: ["online"],
        kind: ["webinar", "club"],
        specialtyScope: "all",
        city: ["kazan"],
        nmoOnly: true,
        direction: ["sports"],
        query: "PRP",
      },
    });
    expect(screen.getByText("Применено: 8")).toBeInTheDocument();
  });

  it("EARS-7.4: countAppliedFacets counts the host's own set only", () => {
    const applied: AppliedFacets = {
      ...EMPTY,
      specialtyScope: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      query: "   ",
      project: ["producers"],
      topic: ["funnels", "retention"],
    };
    expect(countAppliedFacets(applied, "doctor")).toBe(2);
    expect(countAppliedFacets(applied, "academy")).toBe(3);
    expect(countAppliedFacets(EMPTY, "doctor")).toBe(0);
  });

  it("EARS-7.4: «Сбросить» runs onReset when something is applied", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderPanel({ applied: { ...EMPTY, nmoOnly: true }, onReset });
    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("EARS-7.4: a URL-driven consumer gets «Сбросить» as a real link (LD-1)", () => {
    renderPanel({
      applied: { ...EMPTY, nmoOnly: true },
      resetHref: "/events",
      onReset: vi.fn(),
    });
    expect(screen.getByRole("link", { name: "Сбросить" })).toHaveAttribute(
      "href",
      "/events",
    );
  });

  it("EARS-13.1: showHeader={false} renders the bare body for the mobile sheet — no title, count or reset", () => {
    renderPanel({ applied: { ...EMPTY, nmoOnly: true }, showHeader: false });
    expect(
      screen.queryByRole("heading", { name: "Фильтры" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Применено/)).not.toBeInTheDocument();
    expect(screen.queryByText("Сбросить")).not.toBeInTheDocument();
    // The body itself is intact and still one labelled region.
    expect(group("Специальность")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Фильтры" })).toBeInTheDocument();
  });
});

describe("EventsFilter — robustness, identity and focus (EARS-7)", () => {
  it("EARS-7.5: the blocks barrel exposes exactly ONE panel implementation — a consumer cannot reach a fork", () => {
    expect(blocksBarrel.EventsFilter).toBe(EventsFilter);
    expect(blocksBarrel.countAppliedFacets).toBe(countAppliedFacets);
  });

  it("EARS-7.6: a facet whose options or label the consumer omits is dropped, never an empty labelled box", () => {
    const { direction: _direction, ...withoutDirection } = OPTIONS;
    const { nmoOnly: _nmoOnly, ...withoutNmo } = LABELS;
    renderPanel({
      options: { ...withoutDirection, kind: [] },
      labels: withoutNmo,
    });
    expect(
      screen.queryByRole("group", { name: "Вид события" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Направление" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(group("Формат")).toBeInTheDocument();
  });

  it("EARS-7.6: the panel owns no width and no chrome of its own — the host column or sheet places it", () => {
    renderPanel();
    const panel = screen.getByRole("region", { name: "Фильтры" });
    expect(panel.className).not.toMatch(/\bw-|\bborder|\bp-\d/);
  });

  it("EARS-7.7: removing a chip moves focus to the next chip, then to the group's combobox — never to the document", async () => {
    const user = userEvent.setup();
    function Stateful() {
      const [applied, setApplied] = React.useState<AppliedFacets>({
        ...EMPTY,
        city: ["kazan", "moscow"],
      });
      return (
        <EventsFilter
          host="doctor"
          applied={applied}
          options={OPTIONS}
          labels={LABELS}
          onChange={setApplied}
        />
      );
    }
    render(<Stateful />);
    await user.click(screen.getByRole("button", { name: "Убрать: Казань" }));
    expect(
      screen.getByRole("button", { name: "Убрать: Москва" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Убрать: Москва" }));
    expect(within(group("Город")).getByRole("combobox")).toHaveFocus();
  });

  it("EARS-7.7: resetting lands focus on the panel region, not the document", async () => {
    const user = userEvent.setup();
    function Stateful() {
      const [applied, setApplied] = React.useState<AppliedFacets>({
        ...EMPTY,
        nmoOnly: true,
      });
      return (
        <EventsFilter
          host="doctor"
          applied={applied}
          options={OPTIONS}
          labels={LABELS}
          onChange={setApplied}
          onReset={() => setApplied(defaultAppliedFacets())}
        />
      );
    }
    render(<Stateful />);
    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.getByRole("region", { name: "Фильтры" })).toHaveFocus();
  });
});
