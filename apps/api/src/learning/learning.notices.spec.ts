import type { LearningSchoolOpenedNotice } from "@ds/learning/server";
import { describe, expect, it, vi } from "vitest";
import type { Mailer } from "../mailer/mailer.types.js";
import { learningNoticeSender } from "./learning.notices.js";

// 023 EARS-7 (#4019) — the school-opened letters leave the publish response
// path: `schoolOpened` returns at once, and no lookup or relay failure ever
// reaches the caller; each failure is logged by person id or count.

const notice = (personId: string): LearningSchoolOpenedNotice => ({
  personId,
  school: { slug: "heart", title: "Школа сердца" },
  course: { title: "Первый курс" },
});

/** A `db` whose single `select…from…where` resolves to `rows` (or rejects). */
function fakeDb(rows: Promise<Array<{ id: string; email: string | null }>>) {
  const where = vi.fn(() => rows);
  return {
    select: () => ({ from: () => ({ where }) }),
  } as unknown as Parameters<typeof learningNoticeSender>[0];
}

const env = { DOCTOR_PUBLIC_ORIGIN: "https://doctor.ds.test" } as NodeJS.ProcessEnv;

function logger() {
  return { warn: vi.fn(), error: vi.fn() };
}

describe("023 learning — the school-opened notice sender", () => {
  it("EARS-7: returns before the letters are sent (off the response path)", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(() => held);
    const mailer = { sendSchoolOpenedNotice: send } as unknown as Mailer;
    const db = fakeDb(Promise.resolve([{ id: "p1", email: "a@ds.test" }]));

    const out = learningNoticeSender(db, mailer, logger(), env).schoolOpened([
      notice("p1"),
    ]);
    expect(out).toBeUndefined();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release();
  });

  it("EARS-7: a rejected letter is logged by person id and the next one is still sent", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("relay down"))
      .mockResolvedValueOnce(undefined);
    const mailer = { sendSchoolOpenedNotice: send } as unknown as Mailer;
    const db = fakeDb(
      Promise.resolve([
        { id: "p1", email: "a@ds.test" },
        { id: "p2", email: "b@ds.test" },
      ]),
    );
    const log = logger();
    learningNoticeSender(db, mailer, log, env).schoolOpened([
      notice("p1"),
      notice("p2"),
    ]);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        "school-opened notice rejected for person p1",
      ),
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("a@ds.test");
  });

  it("EARS-7: a failed address lookup never reaches the caller and is logged with the count", async () => {
    const send = vi.fn();
    const mailer = { sendSchoolOpenedNotice: send } as unknown as Mailer;
    const db = fakeDb(Promise.reject(new Error("db down")));
    const log = logger();
    expect(() =>
      learningNoticeSender(db, mailer, log, env).schoolOpened([notice("p1")]),
    ).not.toThrow();
    await vi.waitFor(() =>
      expect(log.error).toHaveBeenCalledWith(
        "school-opened notices not sent (1): db down",
      ),
    );
    expect(send).not.toHaveBeenCalled();
  });
});
