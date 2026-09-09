// #2063 — the stable identity catalogue of the golden dataset.
//
// Everything downstream addresses golden rows through THIS module: step 7's
// `route-params.ts`, the regression scenarios, and any hand-driven check on a
// staging slot. The names below are a published contract — renaming one is a
// breaking change for the scenario suite, adding one is not.
//
// Identities are literal, not generated at seed time, because a preview slot is
// a CLONE of the template: a scenario compiled against `golden.events.live.id`
// must address the same row in every slot, in every rebuild of the template, on
// every box.

/** Every golden identity carries this marker in its first group. */
const GOLDEN_UUID_PREFIX = "20630063";

/**
 * Deterministic, RFC-4122-shaped identity for a golden row.
 *
 * The shape is `20630063-<group>-4d5b-8b63-<ordinal>`: version nibble `4` and
 * variant nibble `8` keep it a well-formed v4 so `uuid` columns and the
 * `*_slug_not_uuid` checks behave exactly as they do for production data, while
 * the fixed prefix makes a golden row recognisable at a glance in a `psql`
 * session or a failing scenario dump.
 */
export function goldenUuid(group: number, ordinal: number): string {
  assertRange("group", group, 0xffff);
  assertRange("ordinal", ordinal, 0xffff_ffff_ffff);
  const g = group.toString(16).padStart(4, "0");
  const o = ordinal.toString(16).padStart(12, "0");
  return `${GOLDEN_UUID_PREFIX}-${g}-4d5b-8b63-${o}`;
}

function assertRange(label: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(
      `golden uuid ${label} must be an integer in [0, ${max}], got: ${value}`,
    );
  }
}

/** Group numbers, one per table. Append-only — a reused group re-identifies rows. */
export const GOLDEN_GROUP = Object.freeze({
  users: 0x0001,
  experts: 0x0002,
  projects: 0x0003,
  events: 0x0004,
  registrations: 0x0005,
  eventRecordings: 0x0006,
  consentRecords: 0x0007,
  eventExperts: 0x0008,
  eventProjects: 0x0009,
  doctorSpecialties: 0x000a,
});

/**
 * The golden identity-provider accounts, by catalogue key.
 *
 * The seed NEVER creates these: a seed that provisions its own IdP users would
 * have to invent passwords, and a generated password is either committed (a
 * leak) or lost (an account nobody can sign in as). They are provisioned by the
 * box's `infra/dev-stand/idp` converge, and the seed refuses to run until every
 * subject id below is present in the environment (`idp.ts`).
 */
export const GOLDEN_ACCOUNT_KEYS = [
  "doctorUnverified",
  "doctorVerified",
  "doctorMfa",
  "doctorDeleted",
  "admin",
] as const;

export type GoldenAccountKey = (typeof GOLDEN_ACCOUNT_KEYS)[number];

/**
 * The published catalogue. Read it, never re-derive an id or a slug by hand.
 */
export const golden = Object.freeze({
  doctors: Object.freeze({
    /** Signed up, never confirmed the address — the «подтвердите почту» state. */
    unverified: Object.freeze({
      key: "doctorUnverified" as GoldenAccountKey,
      id: goldenUuid(GOLDEN_GROUP.users, 1),
      email: "golden.doctor.unverified@example.test",
      displayName: "Голубева Анна Сергеевна",
    }),
    /** The default doctor of the regression suite: verified, one primary specialty. */
    verifiedCardiologist: Object.freeze({
      key: "doctorVerified" as GoldenAccountKey,
      id: goldenUuid(GOLDEN_GROUP.users, 2),
      email: "golden.doctor.verified@example.test",
      displayName: "Ковалёв Игорь Петрович",
      specialtyName: "Кардиология",
    }),
    /** Verified AND enrolled in a second factor at the IdP (see `idp.ts`). */
    mfaEnrolled: Object.freeze({
      key: "doctorMfa" as GoldenAccountKey,
      id: goldenUuid(GOLDEN_GROUP.users, 3),
      email: "golden.doctor.mfa@example.test",
      displayName: "Соколова Мария Ильинична",
      specialtyName: "Неврология",
    }),
    /** Soft-deleted: `record_status = 'retired'`, `deleted_at` stamped. */
    deleted: Object.freeze({
      key: "doctorDeleted" as GoldenAccountKey,
      id: goldenUuid(GOLDEN_GROUP.users, 4),
      email: "golden.doctor.deleted@example.test",
      displayName: "Тихонов Павел Юрьевич",
    }),
  }),
  admins: Object.freeze({
    platform: Object.freeze({
      key: "admin" as GoldenAccountKey,
      id: goldenUuid(GOLDEN_GROUP.users, 5),
      email: "golden.admin@example.test",
      displayName: "Администратор Платформы",
    }),
  }),
  experts: Object.freeze({
    published: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.experts, 1),
      slug: "golden-expert-published",
    }),
    draft: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.experts, 2),
      slug: "golden-expert-draft",
    }),
  }),
  projects: Object.freeze({
    publishedSchool: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.projects, 1),
      slug: "golden-school-published",
    }),
    draft: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.projects, 2),
      slug: "golden-media-draft",
    }),
  }),
  events: Object.freeze({
    draft: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 1),
      slug: "golden-event-draft",
    }),
    /** Published and still to come — the registration happy path. */
    upcoming: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 2),
      slug: "golden-event-upcoming",
    }),
    /** On air right now relative to the pin — the room happy path. */
    live: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 3),
      slug: "golden-event-live",
    }),
    hidden: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 4),
      slug: "golden-event-hidden",
    }),
    /** Ended, carrying a published edited recording. */
    pastWithRecording: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 5),
      slug: "golden-event-past-recorded",
    }),
    archived: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 6),
      slug: "golden-event-archived",
    }),
  }),
  recordings: Object.freeze({
    /** Published edited recording of {@link golden.events.pastWithRecording}. */
    pastEdited: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.eventRecordings, 1),
    }),
    /** Draft raw recording — visible in the admin, never on the storefront. */
    pastRawDraft: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.eventRecordings, 2),
    }),
  }),
  registrations: Object.freeze({
    /** verifiedCardiologist → upcoming. */
    verifiedOnUpcoming: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.registrations, 1),
    }),
    /** verifiedCardiologist → live (the room roster the gate requires). */
    verifiedOnLive: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.registrations, 2),
    }),
    /** mfaEnrolled → live. */
    mfaOnLive: Object.freeze({ id: goldenUuid(GOLDEN_GROUP.registrations, 3) }),
    /** verifiedCardiologist → pastWithRecording (the «моя запись» path). */
    verifiedOnPast: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.registrations, 4),
    }),
  }),
});

export type GoldenCatalogue = typeof golden;
