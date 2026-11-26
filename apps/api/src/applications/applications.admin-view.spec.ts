import { describe, expect, it } from "vitest";

import { adminViewOf } from "./applications.admin-view.js";

/**
 * 033 EARS-13, EARS-14 — the `partnership` kind (#4032) reads in the admin
 * «Заявки» like every kind: its form's fields with the form's labels, the
 * no-account contact as sent, and that contact as the list's applicant.
 */
describe("033 — the partnership kind's admin view", () => {
  const view = adminViewOf("partnership");
  const resolved = { specialtyName: null };

  it("EARS-14: the detail lists the partnership form's fields with its labels, the company only when sent", () => {
    expect(view).toBeDefined();
    expect(
      view!.fields(
        {
          name: "Ирина",
          companyOrClinic: "Клиника «Здоровье»",
          role: "Партнёр",
        } as never,
        resolved,
      ),
    ).toEqual([
      { key: "name", label: "Имя", value: "Ирина" },
      {
        key: "companyOrClinic",
        label: "Компания или клиника",
        value: "Клиника «Здоровье»",
      },
      { key: "role", label: "Роль", value: "Партнёр" },
    ]);
    expect(
      view!.fields({ name: "Ирина", role: "Эксперт" } as never, resolved),
    ).toEqual([
      { key: "name", label: "Имя", value: "Ирина" },
      { key: "role", label: "Роль", value: "Эксперт" },
    ]);
  });

  it("EARS-14: the detail shows the no-account contact as sent", () => {
    expect(
      view!.contactFields({ emailOrTelegram: "@irina_partner" } as never),
    ).toEqual([
      {
        key: "emailOrTelegram",
        label: "Email или Telegram",
        value: "@irina_partner",
      },
    ]);
  });

  it("EARS-13: the list's applicant column is the contact the guest left", () => {
    expect(
      view!.contactName({ emailOrTelegram: "name@company.ru" } as never),
    ).toBe("name@company.ru");
  });
});
