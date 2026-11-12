import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type { DrizzleHandle } from "@ds/db";
import type { CongressResponse } from "./congress-originals.js";

type Snapshot = Record<string, { row: Record<string, unknown> }[]>;
type Dispatch = {
  email: string;
  to: string;
  eventTitle: string;
  eventVenue: string;
  eventStartsAt: Date;
};
interface IntakeContext {
  pool: DrizzleHandle["pool"];
  eventId: string;
  dir: string;
  consentVersion: string;
  owner: string;
  dispatchSource: string;
  mailer: Record<string, unknown>;
  fake: unknown;
  http: (
    path: string,
    payload?: Record<string, unknown>,
    client?: string,
  ) => Promise<CongressResponse>;
  post: (
    email: string,
    extra?: Record<string, unknown>,
    outcome?: "sent" | "failed",
    client?: string,
  ) => Promise<CongressResponse>;
  payload: (
    email: string,
    extra?: Record<string, unknown>,
  ) => Record<string, unknown>;
  snapshot: () => Promise<Snapshot>;
  mails: () => Record<string, number>;
  seen: { url: string; ip: string; xff: unknown }[];
  load: (name: string) => Promise<{
    congressConfirmationMessage: (input: {
      eventTitle: string;
      eventDate: string;
      eventVenue: string;
    }) => { text: string; html: string };
    formatCongressEventDate: (date: Date) => string;
  }>;
  operation: (command: string) => void;
}

export function createCongressIntake(c: IntakeContext) {
  const mailer = c.mailer as unknown as {
    congressConfirmations: Dispatch[];
    failNextCongressConfirmation: (error: Error) => void;
    sendCongressRegistrationConfirmation: (input: Dispatch) => Promise<void>;
  };
  const fake = c.fake as { hasCredential: (subject: string) => boolean };
  const path = "/api/v1/congress/sign-up";
  let email = "new@example.org";
  let response: CongressResponse;
  let baseline: Snapshot;
  let original: Awaited<ReturnType<typeof records>>;
  let mailBaseline: Record<string, number>;
  let beforeDispatch: Date;
  let restoreMailer: (() => void) | undefined;
  let clients: { a: string; b: string; addressA: string; addressB: string };
  const attempts: string[] = [];
  const evidence = (name: string, value: unknown) =>
    writeFileSync(
      resolve(c.dir, `${name}.json`),
      JSON.stringify(value, null, 2),
    );
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const shape = (r: CongressResponse) => {
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["handoff", "status"]);
    expect(r.body.status).toBe("accepted");
    expect(r.body.handoff).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return {
      status: r.status,
      keys: Object.keys(r.body).sort(),
      state: r.body.status,
      handoffShape: "43base64url",
    };
  };
  async function records() {
    const users = (
      await c.pool.query("SELECT * FROM users WHERE email=$1", [email])
    ).rows;
    expect(users).toHaveLength(1);
    const person = users[0]!;
    const registrations = (
      await c.pool.query(
        "SELECT * FROM registrations WHERE user_id=$1 AND event_id=$2 ORDER BY id",
        [person.id, c.eventId],
      )
    ).rows;
    const consents = (
      await c.pool.query(
        "SELECT * FROM consent_records WHERE user_id=$1 ORDER BY id",
        [person.id],
      )
    ).rows;
    return { person, registrations, consents };
  }
  function confirmations() {
    return mailer.congressConfirmations.filter((mail) => mail.to === email);
  }
  return {
    async happy() {
      baseline = await c.snapshot();
      mailBaseline = c.mails();
      const payload = c.payload(email, {
        patronymic: undefined,
        captchaToken: "native-disabled-policy",
      });
      expect(
        (
          await c.pool.query(
            "SELECT id FROM specialties_minzdrav WHERE id=$1",
            [payload.specialtyId],
          )
        ).rows,
      ).toHaveLength(1);
      beforeDispatch = new Date();
      response = await c.post(email, {
        patronymic: undefined,
        captchaToken: "native-disabled-policy",
      });
      evidence("before", baseline);
    },
    async account() {
      const actual = await records();
      expect((await c.snapshot()).users).toHaveLength(
        baseline.users!.length + 1,
      );
      expect(fake.hasCredential(actual.person.zitadel_sub)).toBe(false);
      expect(actual.person.role).toBe("doctor_guest");
      evidence("account", actual.person);
    },
    async displayName() {
      expect((await records()).person.display_name).toBe("Иванова Мария");
    },
    async registration() {
      const actual = await records();
      expect(actual.registrations).toHaveLength(1);
      expect(actual.registrations[0]).toMatchObject({
        user_id: actual.person.id,
        event_id: c.eventId,
        intake_origin: "site",
      });
      expect((await c.snapshot()).registrations).toHaveLength(
        baseline.registrations!.length + 1,
      );
    },
    async answers() {
      const expected = c.payload(email, { patronymic: undefined });
      delete expected.personalDataConsent;
      delete expected.patronymic;
      expect((await records()).registrations[0]!.answers).toEqual({
        ...expected,
        contactPhoneNormalised: "+79001234567",
      });
    },
    async phone() {
      expect((await records()).person.phone).toBeNull();
    },
    async consent() {
      const actual = await records();
      expect(actual.consents).toHaveLength(1);
      expect(actual.consents[0]).toMatchObject({
        purpose: "congress-personal-data",
        version: c.consentVersion,
      });
      expect((await c.snapshot()).consent_records).toHaveLength(
        baseline.consent_records!.length + 1,
      );
      evidence("records", actual);
    },
    async noMedicalConsent() {
      expect(
        (await records()).consents.filter(
          (row) => row.purpose === "medical-worker-declaration",
        ),
      ).toHaveLength(0);
    },
    async accepted() {
      evidence("accepted-response-shape", shape(response));
    },
    async confirmation() {
      expect(confirmations()).toHaveLength(1);
      const dispatch = confirmations()[0]!;
      expect(dispatch).toMatchObject({
        email,
        eventTitle: "Конгресс-2027",
        eventVenue: "Москва, тестовая площадка",
      });
      expect(dispatch.eventStartsAt.toISOString()).toBe(
        "2027-04-23T06:00:00.000Z",
      );
      expect(c.mails().verificationCodeEmails).toBe(
        mailBaseline.verificationCodeEmails,
      );
      const { congressConfirmationMessage, formatCongressEventDate } =
        await c.load("mailer/notice-emails.js");
      const message = congressConfirmationMessage({
        eventTitle: dispatch.eventTitle,
        eventDate: formatCongressEventDate(dispatch.eventStartsAt),
        eventVenue: dispatch.eventVenue,
      });
      for (const part of [message.text, message.html]) {
        for (const present of [
          "Конгресс-2027",
          "23 апреля 2027",
          "Москва, тестовая площадка",
          "orthobio.ru",
        ])
          expect(part).toContain(present);
        expect(part).not.toMatch(
          /https?:\/\/|href=|\/account\/congress|Подать материалы в кабинете/,
        );
        for (const removed of ["аккаунт", "Пароль не нужен", "/login"])
          expect(part).not.toContain(removed);
      }
      evidence("confirmation", {
        dispatch,
        message,
        basis:
          "044 EARS-13 production amendments; native rendered copy from dispatched values",
      });
    },
    async outcome(status: "sent" | "failed") {
      const row = (await records()).registrations[0]!;
      expect(row.confirmation_mail_status).toBe(status);
      expect(row.confirmation_mail_at).toBeInstanceOf(Date);
      expect(row.confirmation_mail_at.getTime()).toBeGreaterThanOrEqual(
        beforeDispatch.getTime() - 1,
      );
      evidence("outcome", { status, at: row.confirmation_mail_at });
    },
    failMailer() {
      email = `failed-${c.owner}-${randomUUID()}@example.org`;
      const native = mailer.sendCongressRegistrationConfirmation.bind(mailer);
      mailer.sendCongressRegistrationConfirmation = async (input) => {
        attempts.push(input.email);
        return native(input);
      };
      restoreMailer = () => {
        mailer.sendCongressRegistrationConfirmation = native;
      };
      c.operation(
        "Native exhausted-transport port refusal through FakeMailer.failNextCongressConfirmation",
      );
      mailer.failNextCongressConfirmation(
        new Error("owned exhausted mail transport failure"),
      );
    },
    async failedSubmission() {
      baseline = await c.snapshot();
      beforeDispatch = new Date();
      response = await c.post(email, {}, "failed");
      evidence("before", baseline);
    },
    async committedDespiteFailure() {
      original = await records();
      expect(original.registrations).toHaveLength(1);
      expect(original.consents).toHaveLength(1);
      expect(original.consents[0]).toMatchObject({
        purpose: "congress-personal-data",
        version: c.consentVersion,
      });
      expect(original.registrations[0]!.confirmation_mail_status).toBe(
        "failed",
      );
      const after = await c.snapshot();
      for (const table of ["users", "registrations", "consent_records"])
        expect(after[table]).toHaveLength(baseline[table]!.length + 1);
      expect(confirmations()).toHaveLength(0);
      evidence("failed-committed", { records: original, complete: after });
    },
    async noScheduledRetry() {
      expect(attempts.filter((to) => to === email)).toHaveLength(1);
      const barrier = `barrier-${c.owner}-${randomUUID()}@example.org`;
      shape(await c.post(barrier));
      expect(attempts.filter((to) => to === email)).toHaveLength(1);
      expect(await records()).toEqual(original);
      const start = c.dispatchSource.indexOf(
        "  private dispatchConfirmationEmail(",
      );
      expect(start).toBeGreaterThan(0);
      const end = c.dispatchSource.indexOf("\n  /**", start + 1);
      expect(end).toBeGreaterThan(start);
      const dispatch = c.dispatchSource.slice(start, end);
      expect(dispatch).toContain("void (async () =>");
      expect(dispatch).not.toMatch(
        /setTimeout|setInterval|addTimeout|enqueue|\.add\(/,
      );
      evidence("no-automatic-retry", {
        attemptsBefore: 1,
        attemptsAfterLaterDispatch: 1,
        barrier,
        dispatchSourceSha256: hash(c.dispatchSource),
        methodSha256: hash(dispatch),
        schedulingCalls: 0,
      });
    },
    async resubmit() {
      const first = shape(response);
      response = await c.post(email);
      expect(shape(response)).toEqual(first);
    },
    async noDuplicate() {
      const after = await records();
      expect(after.person).toEqual(original.person);
      expect(after.consents).toEqual(original.consents);
      expect(after.registrations).toHaveLength(1);
      expect(after.registrations[0]!.id).toBe(original.registrations[0]!.id);
    },
    async dispatchedAgain() {
      expect(attempts.filter((to) => to === email)).toHaveLength(2);
      expect(confirmations()).toHaveLength(1);
      expect((await records()).registrations[0]!.confirmation_mail_status).toBe(
        "sent",
      );
      evidence("after-explicit-repeat", {
        records: await records(),
        attempts: 2,
        sent: 1,
      });
    },
    async clients() {
      const a = `127.39.${Number(c.owner) % 100}.10`,
        b = `127.39.${Number(c.owner) % 100}.11`;
      const addressA = `client-a-${c.owner}-${randomUUID()}@example.org`,
        addressB = `client-b-${c.owner}-${randomUUID()}@example.org`;
      shape(await c.post(addressA, {}, "sent", a));
      shape(await c.post(addressB, {}, "sent", b));
      baseline = await c.snapshot();
      mailBaseline = c.mails();
      evidence("clients", { a, b, addressA, addressB });
      clients = { a, b, addressA, addressB };
    },
    async exhaust() {
      for (let n = 1; n < 60; n++)
        expect((await c.http(path, {}, clients.a)).status).toBe(400);
      const refusal = await c.http(
        path,
        c.payload(clients.addressA),
        clients.a,
      );
      expect(refusal.status).toBe(429);
      expect(Number(refusal.retryAfter)).toBeGreaterThan(0);
      expect(Number(refusal.retryAfter)).toBeLessThanOrEqual(900);
      expect(await c.snapshot()).toEqual(baseline);
      expect(c.mails()).toEqual(mailBaseline);
      evidence("throttled", {
        consumed: 60,
        next: 429,
        retryAfter: Number(refusal.retryAfter),
        noWrites: true,
      });
    },
    async onlyParticipant() {
      expect(
        (await c.http(path, c.payload(clients.addressA), clients.a)).status,
      ).toBe(429);
      expect(await c.snapshot()).toEqual(baseline);
    },
    async otherAccepted() {
      shape(await c.post(clients.addressB, {}, "sent", clients.b));
      email = `client-b-new-${c.owner}-${randomUUID()}@example.org`;
      shape(await c.post(email, {}, "sent", clients.b));
      expect((await records()).registrations).toHaveLength(1);
      expect(
        (await c.http(path, c.payload(clients.addressA), clients.a)).status,
      ).toBe(429);
      const seen = c.seen.filter(
        (request) =>
          request.url === "/v1/congress/sign-up" &&
          [clients.a, clients.b].includes(request.ip),
      );
      expect(seen).toContainEqual(
        expect.objectContaining({ ip: clients.a, xff: clients.a }),
      );
      expect(seen).toContainEqual(
        expect.objectContaining({ ip: clients.b, xff: clients.b }),
      );
      const manifest = JSON.parse(
        readFileSync(resolve(c.dir, "resources.json"), "utf8"),
      ) as { nginxPid: number; nginxPort: number };
      evidence("accepted-other-client", {
        clients,
        newEmail: email,
        records: await records(),
        resolutions: seen,
        sameNginxPid: manifest.nginxPid,
        sameNginxPort: manifest.nginxPort,
        accessSha256: hash(readFileSync(resolve(c.dir, "access.log"), "utf8")),
      });
      evidence("after", await c.snapshot());
    },
    close() {
      restoreMailer?.();
    },
  };
}
