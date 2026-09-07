import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import DocumentsPage from "./page";

/**
 * 028 EARS-2/3/4/5 — the Academy's «Документы и контакты» index. The page is a
 * server component reading `@ds/legal-content` from disk, so the test renders the
 * awaited element against the REAL published document set: the no-placeholder
 * guarantee (EARS-12) is a filesystem property, and mocking the loader here would
 * assert a fixture instead of the shipped surface.
 *
 * Canvas fidelity (poster, chip spacing) is the Stage-B live drive; this pins the
 * data contract — one row, the exact contacts and requisites strings, and the
 * absence of any `#` stub destination.
 */

afterEach(cleanup);

describe("028 Academy documents index", () => {
  it("028 EARS-2: renders the «Документы и контакты» page for the Academy host", async () => {
    render(await DocumentsPage());

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Документы и контакты");
    // The three blocks of EARS-2, each addressable by its own anchor.
    expect(screen.getByTestId("documents-list")).toBeInTheDocument();
    expect(document.getElementById("contacts")).not.toBeNull();
    expect(document.getElementById("requisites")).not.toBeNull();
  });

  it("028 EARS-3: lists exactly one document row — the personal-data policy", async () => {
    render(await DocumentsPage());

    const rows = within(screen.getByTestId("documents-list")).getAllByRole(
      "link",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/documents/privacy-policy");
    expect(rows[0]).toHaveTextContent("Политика персональных данных и согласия");
    // Slice 1 draws none of the other canvas rows.
    for (const absent of [
      "Лицензия",
      "Пользовательское соглашение",
      "Правила начисления очков",
      "готовится",
    ]) {
      expect(screen.queryByText(new RegExp(absent, "i"))).toBeNull();
    }
    // EARS-11: no row is re-published in R1, so no «обновлено» chip.
    expect(screen.queryByText("обновлено")).toBeNull();
  });

  it("028 EARS-4: renders the support mailbox, the channel chips and the single chip-row caption", async () => {
    render(await DocumentsPage());

    const contacts = screen.getByTestId("documents-contacts");
    expect(
      within(contacts).getByRole("link", { name: "academy@doctor.school" }),
    ).toHaveAttribute("href", "mailto:academy@doctor.school");

    const telegram = within(contacts).getByRole("link", { name: "Telegram" });
    expect(telegram).toHaveAttribute("href", "https://t.me/doctorschool");
    expect(telegram).toHaveAttribute("target", "_blank");
    expect(telegram).toHaveAttribute("rel", "noopener noreferrer");

    // One caption under the chip row — never a per-channel caption.
    expect(
      within(contacts).getByText(
        "Эфиры, фрагменты подкастов, новости проектов.",
      ),
    ).toBeInTheDocument();

    // Hide-until-content: a channel without a recorded URL is not drawn at all.
    // A `#` destination is a banned stub, so no anchor on the page may carry one.
    for (const link of Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    )) {
      expect(link.getAttribute("href")).not.toBe("#");
    }
  });

  it("028 EARS-5: renders the operator requisites line and no counterpart caption", async () => {
    render(await DocumentsPage());

    expect(screen.getByTestId("documents-requisites")).toHaveTextContent(
      "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703",
    );
    // EARS-5: no licence number on the Academy requisites line.
    expect(screen.queryByText(/Лицензия/i)).toBeNull();
    // EARS-6 is the doctor host's counterpart caption only — the Academy list
    // carries none, so nothing here links out to the doctor storefront.
    const outbound = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="https://doctor.school"]'),
    );
    expect(outbound).toHaveLength(0);
  });
});
