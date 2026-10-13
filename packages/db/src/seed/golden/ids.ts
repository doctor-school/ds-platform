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

/** The exact shape `goldenUuid` mints — prefix, version and variant included. */
const GOLDEN_UUID_RE = new RegExp(
  `^${GOLDEN_UUID_PREFIX}-[0-9a-f]{4}-4d5b-8b63-[0-9a-f]{12}$`,
);

/**
 * True only for a uuid this module minted.
 *
 * The marker is the whole prefix, not the ordinal tail: a production uuid can
 * carry any tail at all, so a tail-only test answers `true` for rows the golden
 * seed never wrote.
 */
export function isGoldenUuid(id: string): boolean {
  return GOLDEN_UUID_RE.test(id);
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
  // #2213 part D — the taxonomy families the admin lists and the doctor feed
  // resolve through. Appended, never interleaved: every group above keeps the
  // number it was minted with.
  directions: 0x000b,
  partners: 0x000c,
  directionSpecialties: 0x000d,
  directionAdjacency: 0x000e,
  eventDirections: 0x000f,
  projectExperts: 0x0010,
  projectPartners: 0x0011,
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
  // #2805 — the worker pool of `doctorVerified` (see `GOLDEN_WORKER_POOL_SIZE`).
  "doctorVerifiedW1",
  "doctorVerifiedW2",
  "doctorVerifiedW3",
  "doctorVerifiedW4",
  "doctorVerifiedW5",
] as const;

export type GoldenAccountKey = (typeof GOLDEN_ACCOUNT_KEYS)[number];

/**
 * #2805 — how many Playwright workers the regression suite may run at once.
 *
 * The suite runs on parallel workers, and a golden account that two workers sign
 * in as at the same time is shared state: one worker's logout revokes the other's
 * session, one worker's password-reset request arms a challenge the other's code
 * sign-in reads past. So every golden doctor a scenario SIGNS IN AS exists once
 * per worker: worker 0 is the catalogue account itself, workers 1..N-1 are its
 * pool copies below — same role, same specialty, same registrations, the same
 * password env var (no new secret), their own address and IdP subject. A run with
 * more workers than this ceiling fails loudly in `packages/e2e/lib/golden.ts`
 * rather than letting two workers share an account.
 *
 * Only `verifiedCardiologist` is pooled: it is the one golden doctor any scenario
 * or walk signs in as. `mfaEnrolled` and `admin` carry a second factor enrolled in
 * the owner's authenticator (no automation can sign in as them), `unverified` is
 * named by no scenario and `deleted` has no IdP account at all.
 */
export const GOLDEN_WORKER_POOL_SIZE = 6;

/** The default doctor of the regression suite: verified, one primary specialty. */
const VERIFIED_CARDIOLOGIST = Object.freeze({
  key: "doctorVerified" as GoldenAccountKey,
  id: goldenUuid(GOLDEN_GROUP.users, 2),
  email: "golden.doctor.verified@example.test",
  displayName: "Ковалёв Игорь Петрович",
  specialtyName: "Кардиология",
});

/** Worker `n`'s copy of the verified doctor (n ≥ 1; worker 0 is the original). */
function verifiedCardiologistCopy(worker: number) {
  return Object.freeze({
    key: `doctorVerifiedW${worker}` as GoldenAccountKey,
    // Ordinal 100 + n: inside the named range (< GOLDEN_VOLUME_ORDINAL_BASE) and
    // clear of the five named users.
    id: goldenUuid(GOLDEN_GROUP.users, 100 + worker),
    email: `golden.doctor.verified.w${worker}@example.test`,
    displayName: VERIFIED_CARDIOLOGIST.displayName,
    specialtyName: VERIFIED_CARDIOLOGIST.specialtyName,
  });
}

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
    verifiedCardiologist: VERIFIED_CARDIOLOGIST,
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
  /**
   * #2805 — per-worker accounts, indexed by Playwright `parallelIndex`:
   * `[0]` is the catalogue account, `[n]` its pool copy (see
   * `GOLDEN_WORKER_POOL_SIZE`).
   */
  workerPool: Object.freeze({
    verifiedCardiologist: Object.freeze([
      VERIFIED_CARDIOLOGIST,
      ...Array.from({ length: GOLDEN_WORKER_POOL_SIZE - 1 }, (_, i) =>
        verifiedCardiologistCopy(i + 1),
      ),
    ]),
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
    /**
     * On air right now relative to the pin — the doctor storefront's room
     * happy path and its «Идёт сейчас» block (a `doctors` event).
     */
    live: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 3),
      slug: "golden-event-live",
    }),
    /** On air right now relative to the pin — the Academy's room happy path. */
    academyLive: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.events, 7),
      slug: "golden-event-live-academy",
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
    /** verifiedCardiologist → academyLive (the Academy room roster). */
    verifiedOnAcademyLive: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.registrations, 5),
    }),
    /** verifiedCardiologist → pastWithRecording (the «моя запись» path). */
    verifiedOnPast: Object.freeze({
      id: goldenUuid(GOLDEN_GROUP.registrations, 4),
    }),
  }),
});

export type GoldenCatalogue = typeof golden;

/**
 * 012 EARS-27 (#2509) — the five seed event kinds. They are NOT golden rows:
 * migration 0046 inserts them into every database with these fixed ids, and
 * the golden seed only REFERENCES them (an editor may rename or retire them
 * like any other kind, so only the id and slug are relied on here).
 */
export const SEED_EVENT_KINDS = Object.freeze({
  vebinar: Object.freeze({
    id: "00460046-0000-4000-8000-000000000001",
    slug: "vebinar",
  }),
  efir: Object.freeze({
    id: "00460046-0000-4000-8000-000000000002",
    slug: "efir",
  }),
  kongress: Object.freeze({
    id: "00460046-0000-4000-8000-000000000003",
    slug: "kongress",
  }),
  vstrechaKluba: Object.freeze({
    id: "00460046-0000-4000-8000-000000000004",
    slug: "vstrecha-kluba",
  }),
  masterKlass: Object.freeze({
    id: "00460046-0000-4000-8000-000000000005",
    slug: "master-klass",
  }),
});
