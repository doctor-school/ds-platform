import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACADEMY_CONSENT,
  saveAcademyPartnershipSubmission,
} from "./academy-partnership-store";

const submission = {
  idempotencyKey: "46f5190b-93c4-47af-89de-17d5030e9cad",
  name: "Анна Соколова",
  companyOrClinic: "Клиника",
  contact: "@partner_name",
  role: "Партнёр" as const,
  consent: true as const,
};

describe("Feature 013 private JSON store", () => {
  it("EARS-6: an accepted retry shall create exactly one private UUID JSON record with immutable consent evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "academy-partnership-"));

    const first = await saveAcademyPartnershipSubmission(submission, directory);
    const retry = await saveAcademyPartnershipSubmission(submission, directory);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));

    expect(retry).toEqual(first);
    expect(files).toEqual([`${first.id}.json`]);
    const filePath = join(directory, files[0]!);
    const record = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    expect(record).toMatchObject({
      id: first.id,
      name: "Анна Соколова",
      companyOrClinic: "Клиника",
      contact: "@partner_name",
      role: "Партнёр",
      idempotencyKey: submission.idempotencyKey,
      consent: {
        purpose: "academy_partnership_contact",
        versionTag: "academy-partnership-v1",
        text: ACADEMY_CONSENT.text,
        textSha256: ACADEMY_CONSENT.textSha256,
        accepted: true,
        policyUrl: "https://doctor.school/index/privacy-pay",
      },
    });
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("EARS-7: an unsafe or unavailable target shall fail closed without a partial JSON record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "academy-partnership-"));
    const missingTarget = join(directory, "missing", "submissions");

    await expect(
      saveAcademyPartnershipSubmission(submission, missingTarget),
    ).rejects.toThrow();
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
