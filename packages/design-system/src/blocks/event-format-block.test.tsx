import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EventFormatBlock } from "./event-format-block";

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
    // The union carries ONE member on purpose — offline/hybrid are #1771, and a
    // placeholder branch here would be an untracked seam.
    expect(screen.getByTestId("event-format-block")).toHaveAttribute(
      "data-format-kind",
      "online",
    );
  });

  it("020 EARS-1: the block shall omit the during-эфир line a host does not supply", () => {
    render(<EventFormatBlock kind="online" roomOpensLine="Комната откроется" />);

    const block = screen.getByTestId("event-format-block");
    expect(block).toHaveTextContent("Комната откроется");
    expect(block.querySelectorAll("span")).toHaveLength(3);
  });
});
