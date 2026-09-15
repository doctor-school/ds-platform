// #2063 — the golden dataset itself: every row the staging template database
// carries, derived from ONE resolved «now» and a fixed identity catalogue.
//
// Shape rules this module obeys, all of them load-bearing for the §9 drift rule:
//   * no `Date.now()`, no `new Date()` without an argument, no `defaultNow()`
//     reliance — `created_at`/`updated_at` are written explicitly, otherwise two
//     builds of `ds_golden` differ in every row's audit columns;
//   * no generated ids — identities come from `ids.ts`;
//   * no IdP writes — `zitadel_sub` mirrors an env-declared subject (`idp.ts`).
//
// The dataset covers every state the specs distinguish, because a regression
// contour that only carries the happy path proves only the happy path.

import type { NewConsentRecord } from "../../schema/consent-records.js";
import type { NewEventRecording } from "../../schema/event-recordings.js";
import type { NewEvent, NewStreamConfigRow } from "../../schema/events.js";
import type { NewRegistration } from "../../schema/registrations.js";
import type {
  NewEventExpert,
  NewEventProject,
  NewExpert,
  NewProject,
} from "../../schema/taxonomy.js";
import type { NewUser } from "../../schema/users.js";
import { RAZDEL_I_NAMES } from "../specialties-minzdrav.data.js";
import { GOLDEN_CONSENT_PURPOSES, GOLDEN_CONSENT_VERSION } from "./consent.js";
import { golden, GOLDEN_GROUP, goldenUuid } from "./ids.js";
import type { GoldenSubjectMap } from "./idp.js";
import { GOLDEN_IDP_ACCOUNTS } from "./idp.js";
import { goldenDateOnly, shiftFromNow } from "./now.js";
import { buildGoldenVolume } from "./volume.js";

// The pinned legal acceptances live in `consent.ts` so the volume half can write
// them without importing this module back (a runtime cycle). Re-exported here so
// the public surface of the dataset is unchanged.
export { GOLDEN_CONSENT_PURPOSES, GOLDEN_CONSENT_VERSION } from "./consent.js";

/**
 * A doctor↔specialty link BEFORE resolution.
 *
 * `specialties_minzdrav.id` belongs to the book seed
 * (`seedSpecialtiesMinzdrav`), not to this dataset. The seed derives it from the
 * row's `code`, so a freshly built template gets the same id every time — but a
 * database seeded before that derivation still holds a random id, and the
 * conflict branch never rewrites one. Pinning an id here would make the golden
 * seed depend on a value it does not own. The link therefore carries the stable
 * `name`, and the planner resolves it to an id at seed time.
 */
export interface GoldenDoctorSpecialtyLink {
  id: string;
  doctorId: string;
  specialtyName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoldenDataset {
  users: NewUser[];
  experts: NewExpert[];
  projects: NewProject[];
  events: NewEvent[];
  streamConfig: NewStreamConfigRow[];
  eventExperts: NewEventExpert[];
  eventProjects: NewEventProject[];
  registrations: NewRegistration[];
  eventRecordings: NewEventRecording[];
  consentRecords: NewConsentRecord[];
  doctorSpecialties: GoldenDoctorSpecialtyLink[];
}

/** Raised when the dataset itself is inconsistent — a fixture defect, not a run defect. */
export class GoldenDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenDatasetError";
  }
}

/**
 * Builds every golden row for the resolved «now» (see `now.ts`).
 *
 * Deterministic in both arguments: the same `now` and the same subject map
 * always yield byte-identical rows.
 */
export function buildGoldenDataset(
  now: Date,
  subjects: GoldenSubjectMap,
): GoldenDataset {
  const at = (offset: Parameters<typeof shiftFromNow>[1]) =>
    shiftFromNow(now, offset);
  const created = at({ days: -90 });

  const subjectOf = (key: keyof GoldenSubjectMap): string => {
    const subject = subjects[key];
    if (!subject) {
      throw new GoldenDatasetError(`no IdP subject declared for ${key}`);
    }
    return subject;
  };

  const accountOf = (key: keyof GoldenSubjectMap) => {
    const account = GOLDEN_IDP_ACCOUNTS.find((a) => a.key === key);
    if (!account) {
      throw new GoldenDatasetError(`no IdP account declared for ${key}`);
    }
    return account;
  };

  const doctors = golden.doctors;
  const admin = golden.admins.platform;

  // #2213 — the volume half. APPENDED after every named row, never interleaved:
  // the catalogue rows keep their ids, their offsets and their position, so a
  // scenario compiled against the named dataset sees exactly what it saw before.
  const volume = buildGoldenVolume(now);

  const users: NewUser[] = [
    mirrorUser(doctors.unverified, subjectOf("doctorUnverified"), {
      role: accountOf("doctorUnverified").role,
      emailVerified: accountOf("doctorUnverified").emailVerified,
      created,
      updated: created,
    }),
    mirrorUser(doctors.verifiedCardiologist, subjectOf("doctorVerified"), {
      role: accountOf("doctorVerified").role,
      emailVerified: true,
      created,
      updated: at({ days: -30 }),
    }),
    mirrorUser(doctors.mfaEnrolled, subjectOf("doctorMfa"), {
      role: accountOf("doctorMfa").role,
      emailVerified: true,
      created,
      updated: at({ days: -30 }),
    }),
    {
      ...mirrorUser(doctors.deleted, subjectOf("doctorDeleted"), {
        role: accountOf("doctorDeleted").role,
        emailVerified: true,
        created,
        updated: at({ days: -7 }),
      }),
      // 018 erasure shape: retired iff deleted (`users_retired_iff_deleted`).
      recordStatus: "retired",
      deletedAt: at({ days: -7 }),
      deactivatedAt: at({ days: -7 }),
    },
    mirrorUser(admin, subjectOf("admin"), {
      role: accountOf("admin").role,
      emailVerified: true,
      created,
      updated: created,
    }),
    ...volume.users,
  ];

  const experts: NewExpert[] = [
    {
      id: golden.experts.published.id,
      slug: golden.experts.published.slug,
      familyName: "Ветров",
      givenName: "Дмитрий",
      patronymic: "Аркадьевич",
      professionalRole: "Профессор кафедры кардиологии",
      credentials: "д.м.н., профессор",
      affiliation: "НМИЦ кардиологии",
      bio: "Эталонный эксперт золотого набора: опубликован, привязан к опубликованному событию и к проекту-школе.",
      status: "published",
      firstPublishedAt: at({ days: -60 }),
      version: 1,
      createdAt: created,
      updatedAt: at({ days: -60 }),
    },
    {
      id: golden.experts.draft.id,
      slug: golden.experts.draft.slug,
      familyName: "Ларина",
      givenName: "Ольга",
      patronymic: "Викторовна",
      professionalRole: "Врач-невролог",
      status: "draft",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    ...volume.experts,
  ];

  const projects: NewProject[] = [
    {
      id: golden.projects.publishedSchool.id,
      slug: golden.projects.publishedSchool.slug,
      kind: "school",
      title: "Школа кардиолога (эталон)",
      description:
        "Опубликованный проект-школа золотого набора: несёт куратора-эксперта и опубликованные события.",
      status: "published",
      firstPublishedAt: at({ days: -60 }),
      version: 1,
      createdAt: created,
      updatedAt: at({ days: -60 }),
    },
    {
      id: golden.projects.draft.id,
      slug: golden.projects.draft.slug,
      kind: "media",
      title: "Медиапроект в черновике (эталон)",
      status: "draft",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    ...volume.projects,
  ];

  const events: NewEvent[] = [
    baseEvent({
      id: golden.events.draft.id,
      slug: golden.events.draft.slug,
      title: "Черновик эфира (эталон)",
      startsAt: at({ days: 30 }),
      state: "draft",
      created,
      updated: created,
      specialties: ["Кардиология"],
    }),
    baseEvent({
      id: golden.events.upcoming.id,
      slug: golden.events.upcoming.slug,
      title: "Предстоящий эфир (эталон)",
      startsAt: at({ days: 14 }),
      state: "published",
      created,
      updated: at({ days: -20 }),
      specialties: ["Кардиология", "Терапия"],
      seatsLeft: 120,
    }),
    {
      ...baseEvent({
        id: golden.events.live.id,
        slug: golden.events.live.slug,
        title: "Идущий сейчас эфир (эталон)",
        // Started 15 minutes before the pin: live, and far enough from the
        // boundary that a slow scenario never races the transition.
        startsAt: at({ minutes: -15 }),
        state: "live",
        created,
        updated: at({ minutes: -15 }),
        specialties: ["Кардиология"],
      }),
      // 007 stamps `live_at` on the transition; a live event without it cannot
      // render the room's live-duration element (#717).
      liveAt: at({ minutes: -15 }),
    },
    baseEvent({
      id: golden.events.hidden.id,
      slug: golden.events.hidden.slug,
      title: "Скрытый эфир (эталон)",
      startsAt: at({ days: 7 }),
      state: "hidden",
      created,
      updated: at({ days: -3 }),
      specialties: ["Неврология"],
    }),
    {
      ...baseEvent({
        id: golden.events.pastWithRecording.id,
        slug: golden.events.pastWithRecording.slug,
        title: "Прошедший эфир с записью (эталон)",
        startsAt: at({ days: -30 }),
        state: "ended",
        created,
        updated: at({ days: -29 }),
        specialties: ["Кардиология", "Терапия"],
      }),
      liveAt: at({ days: -30 }),
      recordingExpectedBy: goldenDateOnly(at({ days: -23 })),
    },
    {
      ...baseEvent({
        id: golden.events.archived.id,
        slug: golden.events.archived.slug,
        title: "Архивный эфир (эталон)",
        startsAt: at({ days: -365 }),
        state: "in_archive",
        created: at({ days: -400 }),
        updated: at({ days: -300 }),
        specialties: ["Терапия"],
      }),
      origin: "legacy",
      liveAt: at({ days: -365 }),
    },
    ...volume.events,
  ];

  const streamConfig: NewStreamConfigRow[] = [
    {
      eventId: golden.events.live.id,
      provider: "rutube",
      embedRef: "golden-live-embed",
    },
    {
      eventId: golden.events.pastWithRecording.id,
      provider: "rutube",
      embedRef: "golden-past-embed",
    },
    ...volume.streamConfig,
  ];

  // #1943 — the seeded event carries an expert, so the event page's expert block
  // is exercised by the contour instead of rendering an empty slot.
  const eventExperts: NewEventExpert[] = [
    {
      id: goldenUuid(GOLDEN_GROUP.eventExperts, 1),
      eventId: golden.events.upcoming.id,
      expertId: golden.experts.published.id,
      role: "Спикер",
      position: 0,
      status: "active",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: goldenUuid(GOLDEN_GROUP.eventExperts, 2),
      eventId: golden.events.live.id,
      expertId: golden.experts.published.id,
      role: "Спикер",
      position: 0,
      status: "active",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: goldenUuid(GOLDEN_GROUP.eventExperts, 3),
      eventId: golden.events.pastWithRecording.id,
      expertId: golden.experts.published.id,
      role: "Спикер",
      position: 0,
      status: "active",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    ...volume.eventExperts,
  ];

  const eventProjects: NewEventProject[] = [
    {
      id: goldenUuid(GOLDEN_GROUP.eventProjects, 1),
      eventId: golden.events.upcoming.id,
      projectId: golden.projects.publishedSchool.id,
      status: "active",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: goldenUuid(GOLDEN_GROUP.eventProjects, 2),
      eventId: golden.events.pastWithRecording.id,
      projectId: golden.projects.publishedSchool.id,
      status: "active",
      version: 1,
      createdAt: created,
      updatedAt: created,
    },
    ...volume.eventProjects,
  ];

  const registrations: NewRegistration[] = [
    {
      id: golden.registrations.verifiedOnUpcoming.id,
      userId: doctors.verifiedCardiologist.id,
      eventId: golden.events.upcoming.id,
      registeredAt: at({ days: -10 }),
      recordStatus: "active",
    },
    {
      id: golden.registrations.verifiedOnLive.id,
      userId: doctors.verifiedCardiologist.id,
      eventId: golden.events.live.id,
      registeredAt: at({ days: -5 }),
      recordStatus: "active",
    },
    {
      id: golden.registrations.mfaOnLive.id,
      userId: doctors.mfaEnrolled.id,
      eventId: golden.events.live.id,
      registeredAt: at({ days: -5 }),
      recordStatus: "active",
    },
    {
      id: golden.registrations.verifiedOnPast.id,
      userId: doctors.verifiedCardiologist.id,
      eventId: golden.events.pastWithRecording.id,
      registeredAt: at({ days: -40 }),
      recordStatus: "active",
    },
    ...volume.registrations,
  ];

  const eventRecordings: NewEventRecording[] = [
    {
      id: golden.recordings.pastEdited.id,
      eventId: golden.events.pastWithRecording.id,
      kind: "edited",
      provider: "rutube",
      embedRef: "golden-past-recording-edited",
      posterRef: "golden-past-recording-poster",
      durationSec: 3600,
      status: "published",
      firstPublishedAt: at({ days: -25 }),
      version: 1,
      createdAt: at({ days: -28 }),
      updatedAt: at({ days: -25 }),
    },
    {
      id: golden.recordings.pastRawDraft.id,
      eventId: golden.events.pastWithRecording.id,
      kind: "raw",
      provider: "rutube",
      embedRef: "golden-past-recording-raw",
      durationSec: 4200,
      status: "draft",
      version: 1,
      createdAt: at({ days: -29 }),
      updatedAt: at({ days: -29 }),
    },
    ...volume.eventRecordings,
  ];

  // Golden «legal documents»: the pinned acceptances (see GOLDEN_CONSENT_PURPOSES).
  const consentBearers = [
    doctors.unverified,
    doctors.verifiedCardiologist,
    doctors.mfaEnrolled,
    doctors.deleted,
  ];
  const consentRecords: NewConsentRecord[] = [
    ...consentBearers.flatMap((doctor, doctorIndex) =>
      GOLDEN_CONSENT_PURPOSES.map((purpose, purposeIndex) => ({
        id: goldenUuid(
          GOLDEN_GROUP.consentRecords,
          doctorIndex * 10 + purposeIndex + 1,
        ),
        userId: doctor.id,
        purpose,
        version: GOLDEN_CONSENT_VERSION,
        capturedAt: created,
      })),
    ),
    ...volume.consentRecords,
  ];

  const doctorSpecialties: GoldenDoctorSpecialtyLink[] = [
    {
      id: goldenUuid(GOLDEN_GROUP.doctorSpecialties, 1),
      doctorId: doctors.verifiedCardiologist.id,
      specialtyName: doctors.verifiedCardiologist.specialtyName,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: goldenUuid(GOLDEN_GROUP.doctorSpecialties, 2),
      doctorId: doctors.mfaEnrolled.id,
      specialtyName: doctors.mfaEnrolled.specialtyName,
      createdAt: created,
      updatedAt: created,
    },
    ...volume.doctorSpecialties,
  ];

  const specialtyIssues = goldenSpecialtyIssues(doctorSpecialties);
  if (specialtyIssues.length > 0) {
    throw new GoldenDatasetError(specialtyIssues.join("; "));
  }

  return {
    users,
    experts,
    projects,
    events,
    streamConfig,
    eventExperts,
    eventProjects,
    registrations,
    eventRecordings,
    consentRecords,
    doctorSpecialties,
  };
}

/**
 * Golden specialty links that name something the Минздрав nomenclature does not
 * carry.
 *
 * The book is a CLOSED reference (017): a golden doctor whose specialty is not
 * in it could never be produced by the product path, so a fixture that invents
 * one would let a scenario pass against data the platform cannot create.
 */
export function goldenSpecialtyIssues(
  links: readonly GoldenDoctorSpecialtyLink[],
): string[] {
  return links
    .filter((link) => !RAZDEL_I_NAMES.includes(link.specialtyName))
    .map(
      (link) =>
        `golden specialty "${link.specialtyName}" is not a member of the Минздрав book — the golden dataset may only reference seeded specialties`,
    );
}

interface MirrorOptions {
  role: string;
  emailVerified: boolean;
  created: Date;
  updated: Date;
}

function mirrorUser(
  account: { id: string; email: string; displayName: string },
  zitadelSub: string,
  options: MirrorOptions,
): NewUser {
  return {
    id: account.id,
    zitadelSub,
    email: account.email,
    displayName: account.displayName,
    emailVerified: options.emailVerified,
    phoneVerified: false,
    role: options.role,
    recordStatus: "active",
    createdAt: options.created,
    updatedAt: options.updated,
  };
}

interface BaseEventOptions {
  id: string;
  slug: string;
  title: string;
  startsAt: Date;
  state: NonNullable<NewEvent["state"]>;
  created: Date;
  updated: Date;
  specialties: string[];
  seatsLeft?: number;
}

function baseEvent(options: BaseEventOptions): NewEvent {
  return {
    id: options.id,
    slug: options.slug,
    title: options.title,
    school: "Doctor.School",
    startsAt: options.startsAt,
    durationMin: 60,
    description:
      "Событие золотого набора. Данные детерминированы и привязаны к закреплённому GOLDEN_NOW.",
    specialties: options.specialties,
    state: options.state,
    origin: "platform",
    participationFormat: "online",
    seatsLeft: options.seatsLeft ?? null,
    version: 1,
    recordStatus: "active",
    createdAt: options.created,
    updatedAt: options.updated,
  };
}
