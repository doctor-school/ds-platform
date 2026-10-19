import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EventFormatBlock,
  EventFormatRoomPanel,
  EventFormatSeatsPanel,
} from "./event-format-block";

afterEach(cleanup);

describe("<EventFormatBlock>", () => {
  it("020 EARS-1: the online format block shall state when the room opens and what happens inside it", () => {
    render(
      <EventFormatBlock
        kind="online"
        roomOpensLine="Комната эфира откроется за 10 минут до начала"
        duringLine="Во время эфира: вопрос лектору · опросы · отметки присутствия для НМО"
      />,
    );

    expect(screen.getByText("Эфир")).toBeInTheDocument();
    expect(
      screen.getByText("Комната эфира откроется за 10 минут до начала"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Во время эфира: вопрос лектору · опросы · отметки присутствия для НМО",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("event-format-block")).toHaveAttribute(
      "data-format-kind",
      "online",
    );
  });

  it("020 EARS-1: the block shall omit the during-эфир line a host does not supply", () => {
    render(
      <EventFormatBlock kind="online" roomOpensLine="Комната откроется" />,
    );

    const block = screen.getByTestId("event-format-block");
    expect(block).toHaveTextContent("Комната откроется");
    expect(block.querySelectorAll("span")).toHaveLength(3);
  });

  it("020 EARS-8: the offline block states the remaining seats, and no ticket, QR or venue line", () => {
    render(
      <EventFormatBlock
        kind="offline"
        heading="Места"
        seatsLine="Осталось 12 мест"
      />,
    );

    const block = screen.getByTestId("event-format-block");
    expect(block).toHaveAttribute("data-format-kind", "offline");
    expect(screen.getByText("Места")).toBeInTheDocument();
    expect(screen.getByTestId("event-format-seats")).toHaveTextContent(
      "Осталось 12 мест",
    );
    expect(block).not.toHaveTextContent(/билет|QR/iu);
    expect(block.querySelector("button, a, img")).toBeNull();
  });

  it("020 EARS-9: the hybrid block states why it opens on «онлайн», above its switcher", () => {
    render(
      <EventFormatBlock
        kind="hybrid"
        heading="Как участвовать"
        statement={{
          title: "Очных мест не осталось",
          body: "Участвуйте онлайн — эфир тот же.",
        }}
        switcher={<div data-testid="switcher">tabs</div>}
      />,
    );

    const block = screen.getByTestId("event-format-block");
    expect(block).toHaveAttribute("data-format-kind", "hybrid");
    const statement = screen.getByTestId("event-format-statement");
    expect(statement).toHaveTextContent("Очных мест не осталось");
    expect(statement).toHaveTextContent("Участвуйте онлайн — эфир тот же.");
    expect(
      statement.compareDocumentPosition(screen.getByTestId("switcher")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("020 EARS-8: a hybrid block with seats left carries no statement", () => {
    render(
      <EventFormatBlock
        kind="hybrid"
        heading="Как участвовать"
        statement={null}
        switcher={<div>tabs</div>}
      />,
    );
    expect(screen.queryByTestId("event-format-statement")).toBeNull();
  });

  it("020 EARS-8: the panels are the tab bodies — the room panel without the opening line once started", () => {
    render(
      <>
        <EventFormatRoomPanel duringLine="Во время эфира: вопрос лектору" />
        <EventFormatSeatsPanel seatsLine="Мест не осталось" />
      </>,
    );
    expect(screen.queryByText(/откроется/u)).toBeNull();
    expect(
      screen.getByText("Во время эфира: вопрос лектору"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("event-format-seats")).toHaveTextContent(
      "Мест не осталось",
    );
  });
});
