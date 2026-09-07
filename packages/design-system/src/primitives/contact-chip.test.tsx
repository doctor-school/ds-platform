import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContactChip } from "./contact-chip";

afterEach(cleanup);

/**
 * `ContactChip` (028, #1966). The one behaviour the chip owns is a safety
 * property: an off-platform destination must not hand the opener to the target.
 */
describe("<ContactChip>", () => {
  it("028 EARS-14: opens an https channel in a new tab with the opener severed", () => {
    render(<ContactChip href="https://t.me/doctorschool" label="Telegram" />);

    const chip = screen.getByRole("link", { name: "Telegram" });
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("028 EARS-14: keeps a mailto handoff in place — a new tab would leave the reader on a blank page", () => {
    render(
      <ContactChip href="mailto:support@doctor.school" label="support@doctor.school" />,
    );

    const chip = screen.getByRole("link", {
      name: "support@doctor.school",
    });
    expect(chip).not.toHaveAttribute("target");
    expect(chip).not.toHaveAttribute("rel");
  });

  it("028 EARS-14: hides the channel mark from assistive tech — the label already names the channel", () => {
    render(
      <ContactChip
        href="https://vk.com/doctorschool"
        label="ВКонтакте"
        icon={<span>VK</span>}
      />,
    );

    const chip = screen.getByRole("link", { name: "ВКонтакте" });
    expect(chip.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
