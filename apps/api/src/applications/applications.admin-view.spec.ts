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

/**
 * 034 EARS-10 — the `investor` kind (#4236) reads in the admin «Заявки» like
 * every kind: the «Инвесторам» form's fields with its labels, the optional ones
 * only when sent, and the full name as the list's applicant.
 */
describe("034 — the investor kind's admin view", () => {
  const view = adminViewOf("investor");
  const resolved = { specialtyName: null };

  it("EARS-10: the detail lists organisation, full name, role, work email, phone and task with the form's labels, optional fields only when sent", () => {
    expect(view).toBeDefined();
    expect(
      view!.contactFields({
        organisation: "ООО «Партнёр А»",
        fullName: "Анна Петрова",
        role: "Директор",
        email: "anna@partner-a.test",
        phone: "+7 900 000-00-00",
      } as never),
    ).toEqual([
      { key: "organisation", label: "Организация", value: "ООО «Партнёр А»" },
      { key: "fullName", label: "ФИО", value: "Анна Петрова" },
      { key: "role", label: "Роль в организации", value: "Директор" },
      { key: "email", label: "Рабочая почта", value: "anna@partner-a.test" },
      { key: "phone", label: "Телефон", value: "+7 900 000-00-00" },
    ]);
    expect(
      view!.contactFields({
        organisation: "ООО «Партнёр А»",
        fullName: "Анна Петрова",
        email: "anna@partner-a.test",
      } as never),
    ).toHaveLength(3);
    expect(view!.fields({ task: "Обсудить школу" } as never, resolved)).toEqual(
      [{ key: "task", label: "Задача", value: "Обсудить школу" }],
    );
    expect(view!.fields({} as never, resolved)).toEqual([]);
    expect(view!.contactName({ fullName: "Анна Петрова" } as never)).toBe(
      "Анна Петрова",
    );
  });
});
