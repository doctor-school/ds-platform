import type { RoomCopyStrings } from "@ds/room";

/**
 * 006 EARS-10 (#1722, slice 3, D19 / D22) — the DOCTOR host's half of the room
 * copy contract.
 *
 * `packages/room` is `next-intl`-free by construction, so every string the room
 * paints is injected by its host. The academy injects from its `messages/ru.json`
 * catalogue; this host has no catalogue and no `next-intl` provider (see
 * `app/layout.tsx` — RU-only by decision, not by omission), so its copy is an
 * inline RU const, the same house pattern the storefront event page uses
 * (`app/(storefront)/events/[slug]/page.tsx`). Adding a catalogue for one screen
 * would be scaffolding.
 *
 * The wording is deliberately IDENTICAL to the academy's `room` namespace: the
 * room is one product surface mounted on two storefronts, and a doctor who
 * reaches the same live event from either host must read the same words. That
 * duplication is a tracked fork (`DEBT.md`) whose promotion path is a
 * `ROOM_COPY_RU` default exported by `@ds/room` — taken WHEN the two rooms
 * actually drift or a second locale appears, not before.
 *
 * Only the SERIALIZABLE half lives here (D14) — `satisfies RoomCopyStrings` so a
 * key added to the contract is a TYPE error here, not a blank string in a live
 * room. The four ICU-parameterised values take live client state as arguments and
 * are built in `room-client.tsx`.
 *
 * Deliberately ABSENT (D22): `accessGuidance.*`. Those are the EVENT page's
 * strings (`?from=room`), never the room's.
 */
export const ROOM_COPY = {
  // Header bar.
  liveBadge: "В эфире",
  brandHome: "На главную",
  exit: "Выйти из комнаты",
  themeToggle: "Переключить тему",
  // Room body.
  onAir: "Идёт эфир",
  chatTab: "Чат",
  infoTab: "О эфире",
  chatHeading: "Чат эфира",
  chatCollapse: "Свернуть чат",
  chatExpand: "Развернуть чат",
  chatUnavailable: "Чат временно недоступен. Обновите страницу через несколько минут.",
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
  // Chat panel.
  moderatorPin:
    "📌 Модератор: подключайтесь к обсуждению — вопросы спикерам и коллегам можно задавать прямо в чате.",
  chatLoading: "Загружаем сообщения…",
  chatEmpty: "Пока нет сообщений. Чат откроется, как только начнётся общение.",
  chatParticipant: "Участник",
  chatYou: "Вы",
  chatNewMessages: "Новые сообщения ↓",
  chatSendError: "Не удалось отправить сообщение. Попробуйте ещё раз.",
  chatReconnecting: "Соединение прервалось. Восстанавливаем связь с чатом…",
  chatDisconnected: "Чат отключён. Обновите страницу, чтобы вернуться в обсуждение.",
  composerPlaceholder: "Написать в чат…",
  composerSend: "Отправить",
  // 006 EARS-14 — the JIT display-name step.
  displayNamePrompt: {
    title: "Имя и фамилия",
    description:
      "Введите имя и фамилию — они появятся инициалами в вашем профиле в шапке комнаты. Ваше имя будут видеть участники чата эфира.",
    label: "Имя и фамилия",
    placeholder: "Иван Петров",
    submit: "Продолжить",
    error: "Не удалось сохранить имя. Попробуйте ещё раз.",
  },
  // D18 — the display-name VALIDATION strings. The academy resolves these from
  // its shared `errors.validation` catalogue; this host states the same four.
  errors: {
    displayNameRequired: "Введите имя и фамилию.",
    displayNameTooLong: "Слишком длинное имя — не более 100 символов.",
    required: "Заполните это поле.",
    fallback: "Проверьте введённое значение.",
  },
} satisfies RoomCopyStrings;
