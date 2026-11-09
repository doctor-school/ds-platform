import { z } from "zod";

// 025 attention-points engine — the fact-type catalog and the predicate
// vocabulary (EARS-32, EARS-34; 025-design production amendment A, C, G).
//
// The catalog is CODE and the rules are DATA: registering a fact type or a
// predicate is a developer change; attaching a reward, a limit or a price to
// it is an admin publish (EARS-25). Compliance by construction: a rule reads
// only the attributes declared here, the predicates registered here and the
// settings of `./rules.ts`, and `findForbiddenVocabulary` (pinned by
// fact-types.spec.ts) refuses any name that carries a sponsor, an
// organisation, a medical-representative or partner arrival source, a
// prescription or a sale. The only arrival the vocabulary exposes is the
// doctor-to-doctor referral link, `person.referrer` (EARS-11).
//
// This module only DECLARES; producers that record these facts and the
// predicate implementations live in apps/api (#3838 phase 2 and the producer
// Issues).

/** The value types of the condition language (025-design C). */
export const POINTS_VALUE_TYPES = [
  "string",
  "integer",
  "boolean",
  "instant",
] as const;
export type PointsValueBaseType = (typeof POINTS_VALUE_TYPES)[number];

/** A value type: a base type, nullable or not. */
export interface PointsValueType {
  readonly type: PointsValueBaseType;
  readonly nullable?: boolean;
}

/**
 * A declared fact attribute. `format: "uuid"` and `enum` narrow a string,
 * `min` / `max` bound an integer — the condition type-checker sees only
 * {@link PointsValueType}; the narrowing is enforced when a fact is parsed.
 */
export interface PointsAttributeDeclaration extends PointsValueType {
  readonly format?: "uuid";
  readonly enum?: readonly [string, ...string[]];
  readonly min?: number;
  readonly max?: number;
}

/** What a fact is about (EARS-32): its `ref` names one of these, or none. */
export const POINTS_REF_KINDS = [
  "lesson",
  "module",
  "item",
  "person",
  "none",
] as const;
export type PointsRefKind = (typeof POINTS_REF_KINDS)[number];

/** One catalog entry (EARS-32). The subject is always the fact's `personId`. */
export interface PointsFactTypeEntry {
  /** Stable dotted past-tense type, e.g. `lesson.completed`. */
  readonly type: string;
  readonly refKind: PointsRefKind;
  /** false = no rule on this type may credit Pul (amended EARS-25; EARS-9). */
  readonly earnsPul: boolean;
  readonly attributes: Readonly<Record<string, PointsAttributeDeclaration>>;
}

const LEARNING_MODE = {
  type: "string",
  enum: ["online", "offline", "open"],
} as const satisfies PointsAttributeDeclaration;
const REGISTRATION_ID = {
  type: "string",
  format: "uuid",
} as const satisfies PointsAttributeDeclaration;

/**
 * The registered fact types (025-design G clause map). Keyed by type; the key
 * equals `entry.type` (pinned by the spec).
 */
export const POINTS_FACT_TYPES = {
  /** EARS-5 — the doctor's account was created. */
  "account.registered": {
    type: "account.registered",
    refKind: "none",
    earnsPul: true,
    attributes: {},
  },
  /** EARS-5, EARS-11 — the doctor's phone number was verified. */
  "phone.verified": {
    type: "phone.verified",
    refKind: "none",
    earnsPul: true,
    attributes: {},
  },
  /** EARS-6 — feature 022 verified the doctor's profile. */
  "profile.verified": {
    type: "profile.verified",
    refKind: "none",
    earnsPul: true,
    attributes: {},
  },
  /** EARS-7 — feature 024's computed lesson completion. */
  "lesson.completed": {
    type: "lesson.completed",
    refKind: "lesson",
    earnsPul: true,
    attributes: { mode: LEARNING_MODE },
  },
  /** EARS-8 — all lessons done and the module test passed. */
  "module.completed": {
    type: "module.completed",
    refKind: "module",
    earnsPul: true,
    attributes: { mode: LEARNING_MODE },
  },
  /**
   * EARS-9, EARS-19 — server-side presence on an item; `registrationId` names
   * the registration it settles, null for an attendance without one.
   */
  "attendance.confirmed": {
    type: "attendance.confirmed",
    refKind: "item",
    earnsPul: false,
    attributes: {
      presenceSharePercent: { type: "integer", min: 0, max: 100 },
      registrationId: { ...REGISTRATION_ID, nullable: true },
    },
  },
  /** EARS-10 — a question to the speaker during a live event. */
  "event.question-asked": {
    type: "event.question-asked",
    refKind: "item",
    earnsPul: false,
    attributes: {},
  },
  /** EARS-10 — an item rating. */
  "event.rated": {
    type: "event.rated",
    refKind: "item",
    earnsPul: false,
    attributes: {},
  },
  /** EARS-10 — an interactive answer during a live event. */
  "event.interactive-answered": {
    type: "event.interactive-answered",
    refKind: "item",
    earnsPul: false,
    attributes: {},
  },
  /**
   * EARS-11 — feature 021 linked the invitee (subject) to the inviting doctor
   * (ref). Read through `person.referrer`; a reward is on the invitee's own
   * activity, never on the link itself.
   */
  "referral.attributed": {
    type: "referral.attributed",
    refKind: "person",
    earnsPul: false,
    attributes: {},
  },
  /** EARS-14…17, 21 — a sign-up on a priced item (reserve). */
  "registration.created": {
    type: "registration.created",
    refKind: "item",
    earnsPul: false,
    attributes: { registrationId: REGISTRATION_ID },
  },
  /** EARS-18 — the doctor cancelled the registration. */
  "registration.cancelled": {
    type: "registration.cancelled",
    refKind: "item",
    earnsPul: false,
    attributes: { registrationId: REGISTRATION_ID },
  },
  /** EARS-18 — the platform cancelled or rescheduled the item. */
  "registration.voided": {
    type: "registration.voided",
    refKind: "item",
    earnsPul: false,
    attributes: { registrationId: REGISTRATION_ID },
  },
  /** EARS-18 — the no-show sweep (event id `no-show:<registrationId>`). */
  "registration.no-show": {
    type: "registration.no-show",
    refKind: "item",
    earnsPul: false,
    attributes: { registrationId: REGISTRATION_ID },
  },
  /** EARS-26 — immediate access to a priced item (debit). */
  "item.access-requested": {
    type: "item.access-requested",
    refKind: "item",
    earnsPul: false,
    attributes: {},
  },
  /** EARS-43 — the audited starter-bonus run (event id `starter-bonus:<personId>`). */
  "person.starter-bonus-eligible": {
    type: "person.starter-bonus-eligible",
    refKind: "none",
    earnsPul: true,
    attributes: { runId: { type: "string", format: "uuid" } },
  },
} as const satisfies Record<string, PointsFactTypeEntry>;

export type PointsFactTypeName = keyof typeof POINTS_FACT_TYPES;
export const POINTS_FACT_TYPE_NAMES = Object.keys(
  POINTS_FACT_TYPES,
) as PointsFactTypeName[];
export const PointsFactTypeNameSchema = z.enum(
  POINTS_FACT_TYPE_NAMES as [PointsFactTypeName, ...PointsFactTypeName[]],
);

export function isPointsFactType(value: string): value is PointsFactTypeName {
  return Object.hasOwn(POINTS_FACT_TYPES, value);
}

/** The catalog lookup; undefined for an unregistered type. */
export function getPointsFactType(
  type: string,
): PointsFactTypeEntry | undefined {
  return isPointsFactType(type) ? POINTS_FACT_TYPES[type] : undefined;
}

function attributeSchema(decl: PointsAttributeDeclaration): z.ZodType {
  let base: z.ZodType;
  switch (decl.type) {
    case "string":
      base = decl.enum
        ? z.enum(decl.enum)
        : decl.format === "uuid"
          ? z.uuid()
          : z.string().min(1).max(256);
      break;
    case "integer": {
      let n = z.number().int();
      if (decl.min !== undefined) n = n.min(decl.min);
      if (decl.max !== undefined) n = n.max(decl.max);
      base = n;
      break;
    }
    case "boolean":
      base = z.boolean();
      break;
    case "instant":
      base = z.iso.datetime({ offset: true });
      break;
  }
  return decl.nullable ? base.nullable() : base;
}

/**
 * The strict zod schema of an entry's attributes: every declared attribute
 * required (nullable ones may be null), nothing undeclared accepted — so a
 * fact can carry no amount, no rule id and no forbidden input (EARS-33).
 */
export function pointsFactAttributesSchema(
  entry: PointsFactTypeEntry,
): z.ZodType<Record<string, unknown>> {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(entry.attributes).map(([name, decl]) => [
        name,
        attributeSchema(decl),
      ]),
    ),
  ) as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * A registered predicate (EARS-34): a read-only, side-effect-free lookup over
 * the journal, the account or an owner's read API, memoised per evaluation.
 * `subject` is what it is asked about — the fact's person or the item its ref
 * names. The implementation is injected at evaluation
 * (apps/api `PointsPredicateResolver`); only the signature lives here.
 */
export interface PointsPredicateDeclaration {
  readonly name: string;
  readonly subject: "person" | "item";
  readonly args?: Readonly<Record<string, PointsValueType>>;
  readonly result: PointsValueType;
}

/** The seeded predicates (025-design C). */
export const POINTS_PREDICATES = {
  /** An `account.registered` fact of the person is journaled (or is the fact under evaluation). */
  "person.registered": {
    name: "person.registered",
    subject: "person",
    result: { type: "boolean" },
  },
  /** A `phone.verified` fact of the person is journaled (or is the fact under evaluation). */
  "person.phoneVerified": {
    name: "person.phoneVerified",
    subject: "person",
    result: { type: "boolean" },
  },
  /** Distinct refs of the person's `lesson.completed` facts, the one under evaluation included. */
  "person.completedLessons": {
    name: "person.completedLessons",
    subject: "person",
    result: { type: "integer" },
  },
  /** The inviting doctor's person id from `referral.attributed`, or null (EARS-11). */
  "person.referrer": {
    name: "person.referrer",
    subject: "person",
    result: { type: "string", nullable: true },
  },
  /** The item's price-list Pul price, or null without a price row (EARS-26). */
  "item.price": {
    name: "item.price",
    subject: "item",
    result: { type: "integer", nullable: true },
  },
  /** The item's gating mode `open` | `advance` | `threshold`, or null. */
  "item.mode": {
    name: "item.mode",
    subject: "item",
    result: { type: "string", nullable: true },
  },
  /** The item's price-list `limitedSeats` flag (false without a price row). */
  "item.limitedSeats": {
    name: "item.limitedSeats",
    subject: "item",
    result: { type: "boolean" },
  },
} as const satisfies Record<string, PointsPredicateDeclaration>;

export type PointsPredicateName = keyof typeof POINTS_PREDICATES;

export function isPointsPredicate(value: string): value is PointsPredicateName {
  return Object.hasOwn(POINTS_PREDICATES, value);
}

/**
 * EARS-32 — names the readable vocabulary must never carry: a sponsor, an
 * organisation, a medical-representative or partner arrival source (the
 * referral link is the one permitted arrival), a prescription, a sale or a
 * sponsor-funded value.
 */
const FORBIDDEN_VOCABULARY =
  /sponsor|organi[sz]ation|(^|[^a-z])org(id|anisation)?([^a-z]|$)|med-?rep|medical-?rep|representative|partner|arrival|utm|prescri|rx(?![a-z])|sale|sold|revenue|purchase/i;

/**
 * Every path in the vocabulary whose name is forbidden (EARS-32); [] when
 * clean. Checks fact type names, attribute names and enum values, predicate
 * names and predicate argument names.
 */
export function findForbiddenVocabulary(vocabulary: {
  factTypes: Readonly<Record<string, PointsFactTypeEntry>>;
  predicates: Readonly<Record<string, PointsPredicateDeclaration>>;
}): string[] {
  const found: string[] = [];
  const check = (path: string, name: string) => {
    if (FORBIDDEN_VOCABULARY.test(name)) found.push(path);
  };
  for (const [key, entry] of Object.entries(vocabulary.factTypes)) {
    check(key, key);
    for (const [name, decl] of Object.entries(entry.attributes)) {
      check(`${key}.attributes.${name}`, name);
      for (const value of decl.enum ?? []) {
        check(`${key}.attributes.${name}.enum.${value}`, value);
      }
    }
  }
  for (const [key, pred] of Object.entries(vocabulary.predicates)) {
    check(`predicate ${key}`, key);
    for (const name of Object.keys(pred.args ?? {})) {
      check(`predicate ${key}.args.${name}`, name);
    }
  }
  return found;
}
