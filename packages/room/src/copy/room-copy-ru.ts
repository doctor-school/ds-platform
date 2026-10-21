import type { RoomCopy, RoomCopyStrings } from "./room-copy";

/**
 * 006 EARS-10 — the room's default RU copy (wave-4 gate row 24).
 *
 * The room paints 48 strings (44 room + 4 validation); 47 are the same on both
 * storefronts, and the one host value is the brand-home label, which pairs
 * with the brand-home TARGET of the host's route
 * table (row 22) — «На страницу эфиров» → `/webinars` on the Academy,
 * «На главную» → `/` on the doctor storefront. A host therefore overrides only
 * `brandHome` ({@link roomCopyRu}); the default below carries the Academy label,
 * the wording the room shipped with.
 *
 * `errors.*` (D18) are the shared display-name validation wording — the same
 * four sentences the Academy's `errors.validation` catalogue holds.
 * `accessGuidance` is deliberately absent (D22): it is the event page's
 * sentence, owned by `@ds/event-page`.
 *
 * Pure data, safe on either side of the RSC boundary.
 */
export const ROOM_COPY_RU = {
  liveBadge: "В эфире",
  brandHome: "На страницу эфиров",
  exit: "Выйти из комнаты",
  themeToggle: "Переключить тему",
  onAir: "Идёт эфир",
  chatTab: "Чат",
  infoTab: "О эфире",
  chatHeading: "Чат эфира",
  chatCollapse: "Свернуть чат",
  chatExpand: "Развернуть чат",
  chatUnavailable:
    "Чат временно недоступен. Обновите страницу через несколько минут.",
  unavailableTitle: "Трансляция недоступна",
  unavailableBody:
    "Мы уже знаем о проблеме и восстанавливаем сигнал. Попробуйте обновить страницу.",
  playerTitle: "Трансляция эфира",
  playerRefresh: "Обновить страницу",
  playerFailedTitle: "Трансляция не загружается",
  playerFailedBody:
    "Не удалось запустить воспроизведение. Перезапустите плеер — вы останетесь в комнате.",
  playerEmbeddingDisabled: "Встраивание трансляции отключено её владельцем",
  playerUnavailable: "Видео недоступно",
  playerRetrying: "Переподключаемся к трансляции…",
  playerSuspectedBody:
    "Похоже, трансляция не загружается. Если видео не идёт — перезапустите плеер.",
  playerRestart: "Перезапустить плеер",
  programNow:
    "Эфир идёт. Плеер и чат обновляются автоматически — обновлять страницу не нужно.",
  endedTitle: "Эфир завершён",
  endedBody: "Запись появится в разделе «Мои события»",
  endedBadge: "Эфир завершён",
  chatEnded: "Эфир завершён — сообщения больше не отправляются",
  moderatorPin:
    "📌 Модератор: подключайтесь к обсуждению — вопросы спикерам и коллегам можно задавать прямо в чате.",
  chatLoading: "Загружаем сообщения…",
  chatEmpty: "Пока нет сообщений. Чат откроется, как только начнётся общение.",
  chatParticipant: "Участник",
  chatYou: "Вы",
  chatNewMessages: "Новые сообщения ↓",
  chatSendError: "Не удалось отправить сообщение. Попробуйте ещё раз.",
  chatReconnecting: "Соединение прервалось. Восстанавливаем связь с чатом…",
  chatDisconnected:
    "Чат отключён. Обновите страницу, чтобы вернуться в обсуждение.",
  composerPlaceholder: "Написать в чат…",
  composerSend: "Отправить",
  displayNamePrompt: {
    title: "Имя и фамилия",
    description:
      "Введите имя и фамилию — они появятся инициалами в вашем профиле в шапке комнаты. Ваше имя будут видеть участники чата эфира.",
    label: "Имя и фамилия",
    placeholder: "Иван Петров",
    submit: "Продолжить",
    error: "Не удалось сохранить имя. Попробуйте ещё раз.",
  },
  errors: {
    displayNameRequired: "Введите имя и фамилию.",
    displayNameTooLong: "Слишком длинное имя — не более 100 символов.",
    required: "Заполните это поле.",
    fallback: "Проверьте введённое значение.",
  },
} as const satisfies RoomCopyStrings;

/** RU plural categories and digit grouping, resolved once per module. */
const RU_PLURAL = new Intl.PluralRules("ru");
const RU_NUMBER = new Intl.NumberFormat("ru");

/**
 * Pick the RU plural form and render the count the way an ICU `#` does —
 * grouped by the locale (1000 → «1 000», with a no-break space).
 */
function ruPlural(
  count: number,
  forms: { one: string; few: string; many: string },
): string {
  const category = RU_PLURAL.select(count);
  const noun =
    category === "one"
      ? forms.one
      : category === "few"
        ? forms.few
        : forms.many;
  return `${RU_NUMBER.format(count)} ${noun}`;
}

/**
 * The four parameterised members of {@link RoomCopy} (D22), in RU. Their output
 * is exactly what the Academy ICU messages produced: `#` grouped by the locale,
 * the `{minutes}` simple argument interpolated as-is.
 */
export const ROOM_FORMATTERS_RU = {
  presenceCount: (count: number): string =>
    ruPlural(count, {
      one: "врач в комнате",
      few: "врача в комнате",
      many: "врачей в комнате",
    }),
  liveDuration: (minutes: number): string => `· ${minutes} мин`,
  avatarLabel: (name: string): string => `Ваш профиль: ${name}`,
  chatUnread: (count: number): string =>
    ruPlural(count, {
      one: "новое сообщение",
      few: "новых сообщения",
      many: "новых сообщений",
    }),
} satisfies Pick<
  RoomCopy,
  "presenceCount" | "liveDuration" | "avatarLabel" | "chatUnread"
>;

/** The one host value of the room copy (row 24). */
export interface RoomCopyHostValues {
  /** The brand-home label, paired with the host's brand-home target (row 22). */
  brandHome: string;
}

/**
 * The full RU {@link RoomCopy}: the default strings with the host's brand-home
 * label, plus the four formatters. Functions inside — build it on the client.
 */
export function roomCopyRu(host: RoomCopyHostValues): RoomCopy {
  return { ...ROOM_COPY_RU, brandHome: host.brandHome, ...ROOM_FORMATTERS_RU };
}
