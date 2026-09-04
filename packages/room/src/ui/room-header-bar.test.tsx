import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { initialsFromDisplayName } from "../model/display-name";
import type { RoomCopy, RoomLinkComponent, RoomRoutes } from "../types";
import { RoomHeaderBar } from "./room-header-bar";
import { RoomPresenceProvider } from "./room-presence";

/**
 * 006 EARS-12 / EARS-15 / EARS-2 (#1722) — the header bar after the extraction.
 *
 * The bar used to import the Academy's own `HeaderUserCluster` and `next/link`
 * directly; both are now HOST injections, so what this suite locks is the seam: the
 * host's chrome node reaches the DOM verbatim, the brand and exit affordances route
 * through the host's link component and route table, and the header still refuses to
 * fabricate an identity it was not given (EARS-15 — initials come from the doctor's
 * REAL saved display name and nowhere else).
 */

const routes: RoomRoutes = {
  brandHome: "/webinars",
  eventPage: "/webinars/hsn-therapy",
};

const copy: RoomCopy = {
  liveBadge: "В эфире",
  brandHome: "К списку эфиров",
  exit: "Выйти",
  themeToggle: "Переключить тему",
  onAir: "Идёт эфир",
  chatTab: "Чат",
  infoTab: "О эфире",
  chatHeading: "Чат эфира",
  chatCollapse: "Свернуть",
  chatExpand: "Развернуть",
  chatUnavailable: "Чат недоступен",
  unavailableTitle: "Трансляция недоступна",
  unavailableBody: "Восстанавливаем сигнал",
  playerTitle: "Трансляция эфира",
  playerRefresh: "Обновить страницу",
  playerFailedTitle: "Трансляция не загружается",
  playerFailedBody: "Перезапустите плеер",
  playerEmbeddingDisabled: "Встраивание отключено",
  playerUnavailable: "Видео недоступно",
  playerRetrying: "Переподключаемся…",
  playerSuspectedBody: "Похоже, трансляция не загружается.",
  playerRestart: "Перезапустить плеер",
  programNow: "Эфир идёт",
  moderatorPin: "Модератор",
  chatLoading: "Загружаем сообщения",
  chatEmpty: "Пока нет сообщений",
  chatParticipant: "Участник",
  chatYou: "Вы",
  chatNewMessages: "Новые сообщения",
  chatSendError: "Сообщение не отправлено",
  chatReconnecting: "Восстанавливаем связь…",
  chatDisconnected: "Связь потеряна",
  composerPlaceholder: "Написать сообщение",
  composerSend: "Отправить",
  displayNamePrompt: {
    title: "Имя и фамилия",
    description: "Ваше имя будут видеть участники чата эфира",
    label: "Имя и фамилия",
    placeholder: "Иван Иванов",
    submit: "Продолжить",
    error: "Не удалось сохранить имя",
  },
  errors: {
    displayNameRequired: "Укажите имя и фамилию",
    displayNameTooLong: "Имя слишком длинное",
    required: "Заполните поле",
    fallback: "Проверьте значение",
  },
  presenceCount: (count) => `${count} врачей в комнате`,
  liveDuration: (minutes) => ` · ${minutes} мин`,
  avatarLabel: (name) => `Ваш профиль: ${name}`,
  chatUnread: (count) => `${count} новых сообщений`,
};

function renderBar(props: Partial<Parameters<typeof RoomHeaderBar>[0]> = {}) {
  return render(
    <RoomPresenceProvider initialCount={3}>
      <RoomHeaderBar routes={routes} liveAt={null} copy={copy} {...props} />
    </RoomPresenceProvider>,
  );
}

describe("006 EARS-12/EARS-15 the host-injected room header bar", () => {
  it("EARS-12: the host's chrome cluster is rendered VERBATIM in the header's one slot", () => {
    renderBar({
      userCluster: (
        <div data-testid="host-cluster">
          <button type="button" aria-label={copy.themeToggle}>
            ☾
          </button>
          <span data-testid="room-avatar">ИИ</span>
        </div>
      ),
    });

    const cluster = screen.getByTestId("host-cluster");
    expect(cluster).toBeInTheDocument();
    // The package renders the node as given — it neither re-wraps nor re-labels the
    // host's own app-shell unit (D17a).
    expect(cluster.textContent).toBe("☾ИИ");
    expect(
      screen.getByRole("button", { name: copy.themeToggle }),
    ).toBeInTheDocument();
  });

  it("EARS-15: with no cluster injected the header paints NO avatar — an identity is never fabricated", () => {
    renderBar();

    // #584's refusal, preserved across the extraction: no saved name reached the
    // header, so there is no chip at all — never a placeholder built from an email.
    expect(screen.queryByTestId("room-avatar")).toBeNull();
    // The rest of the bar still renders (the header is not identity-gated).
    expect(screen.getByText("Doctor.School")).toBeInTheDocument();
  });

  it("EARS-15: the initials the host feeds the cluster come from the SAVED display name only", () => {
    const displayName = "Иван Петров";
    renderBar({
      userCluster: (
        <span data-testid="room-avatar" aria-label={copy.avatarLabel(displayName)}>
          {initialsFromDisplayName(displayName)}
        </span>
      ),
    });

    const avatar = screen.getByTestId("room-avatar");
    expect(avatar.textContent).toBe("ИП");
    expect(avatar).toHaveAttribute("aria-label", "Ваш профиль: Иван Петров");
  });

  it("EARS-2: brand home and exit route through the INJECTED link component and the host's route table", () => {
    const seen: string[] = [];
    const HostLink: RoomLinkComponent = ({ href, children, ...rest }) => {
      seen.push(href);
      return (
        <a data-host-link="1" href={href} {...rest}>
          {children}
        </a>
      );
    };

    renderBar({ linkComponent: HostLink });

    expect(seen).toEqual(["/webinars", "/webinars/hsn-therapy"]);
    const brand = screen.getByLabelText(copy.brandHome);
    const exit = screen.getByLabelText(copy.exit);
    expect(brand).toHaveAttribute("data-host-link", "1");
    expect(brand).toHaveAttribute("href", "/webinars");
    expect(exit).toHaveAttribute("data-host-link", "1");
    expect(exit).toHaveAttribute("href", "/webinars/hsn-therapy");
  });

  it("EARS-2: with no link component the package falls back to a plain anchor — it hardcodes no router", () => {
    renderBar();

    const exit = screen.getByLabelText(copy.exit);
    expect(exit.tagName).toBe("A");
    expect(exit).toHaveAttribute("href", "/webinars/hsn-therapy");
  });

  it("EARS-5/EARS-10: the live indicators render the INJECTED ICU callbacks, not a catalogue", () => {
    const liveAt = new Date(Date.now() - 24 * 60_000).toISOString();
    const presenceCount = vi.fn((count: number) => `${count} врачей в комнате`);
    renderBar({ liveAt, copy: { ...copy, presenceCount } });

    expect(presenceCount).toHaveBeenCalledWith(3);
    expect(screen.getByTestId("room-presence-count").textContent).toBe(
      "3 врачей в комнате",
    );
    expect(screen.getByTestId("room-live-duration").textContent).toBe(" · 24 мин");
  });
});
