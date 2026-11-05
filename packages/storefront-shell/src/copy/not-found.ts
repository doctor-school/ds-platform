/**
 * #2478 — the storefront not-found state's words (owner copy, 2026-11-05).
 *
 * Six variants; a render picks one at random, and a variant's heading and line
 * always go together. The labels are the same on both storefronts.
 */
export type NotFoundVariant = {
  readonly title: string;
  readonly text: string;
};

export const NOT_FOUND_COPY = {
  variants: [
    {
      title: "Карточка затерялась в регистратуре",
      text: "Мы поискали, но страницы по этому адресу нет. Возможно, её перенесли или в ссылке опечатка.",
    },
    {
      title: "Этот кабинет у нас не значится",
      text: "Похоже, вы зашли не в ту дверь. Мы и сами иногда путаем этажи — начните с главной.",
    },
    {
      title: "Анализ отрицательный",
      text: "Мы проверили дважды: по этому адресу ничего нет. Возможно, страницу убрали или адрес набран с ошибкой.",
    },
    {
      title: "Страницу уже выписали",
      text: "Здесь её больше нет: возможно, перевели по другому адресу. На главной всё актуальное.",
    },
    {
      title: "Даже рентген ничего не нашёл",
      text: "Страницы по этому адресу нет. Проверьте ссылку или начните с главной.",
    },
    {
      title: "Тут мы сами себе поставили диагноз",
      text: "Ссылка ведёт в никуда — скорее всего, это наша недоработка. Главная точно на месте.",
    },
  ],
  home: "На главную",
  pageTitle: "Страница не найдена — Doctor.School",
} as const satisfies {
  variants: readonly NotFoundVariant[];
  [key: string]: unknown;
};
