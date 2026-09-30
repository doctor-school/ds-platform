import { describe, expect, it } from "vitest";

import { returnContextSlots } from "@ds/auth-flow/login";

import type { AuthFlowHostConfig } from "@ds/auth-flow/host-config";

import {
  DEFAULT_AUTH_FLOW_COPY,
  resolveAuthFlowCopy,
} from "@ds/auth-flow/copy";

import { ACADEMY_AUTH_FLOW } from "./auth-flow.host-config";
import { ACADEMY_ROOM_ROUTES } from "./room-config";
import { LOGIN_HREF, PROFILE_HREF } from "./shell-config";

/**
 * 008 EARS-4 / 006 EARS-6 — the Academy host config states its auth routes as
 * LITERALS, because it is DATA a server route file hands to `@ds/auth-flow` and
 * may not read back out of `lib/`. That inversion is only safe while the
 * literals still equal the SSOTs they were copied from: `lib/navigation-model.ts`
 * owns where the sign-in control and the profile chip point, and
 * `lib/room-config.ts` owns the room template `@ds/room` interpolates. This
 * suite is what fails when one of those moves and the auth flow does not.
 */
describe("ACADEMY_AUTH_FLOW.routes", () => {
  it("EARS-4: the login route equals the navigation model's one guest destination", () => {
    expect(ACADEMY_AUTH_FLOW.routes.login).toBe(LOGIN_HREF);
  });

  it("EARS-4: the account route equals the navigation model's profile destination", () => {
    expect(ACADEMY_AUTH_FLOW.routes.account).toBe(PROFILE_HREF);
  });

  it("EARS-6: the room a bounced visitor returns to is the room `@ds/room` serves", () => {
    expect(ACADEMY_AUTH_FLOW.routes.room).toBe(ACADEMY_ROOM_ROUTES.room);
  });
});

/**
 * #2027 PR 1.6 — what the Academy STATES to the shared sign-up door.
 *
 * `/register` is a mount of `@ds/auth-flow/register/route` now; the door's
 * behaviour is proved once in `packages/auth-flow/src/register/…`, over this
 * host's fixture too. What only this tier can prove is the STATEMENT: the door
 * renders exactly what is stated here, so an absent key is a rendered absence
 * and a wrong value is a wrong screen. Read through the widened type, because
 * the `satisfies` literal cannot answer «is this key absent» on its own.
 */
const config: AuthFlowHostConfig = ACADEMY_AUTH_FLOW;

const RETURN_EVENT = {
  time: "19:00",
  dateLabel: "28 августа · чт",
  school: "Школа ортобиологии",
  title: "PRP при гонартрозе: показания, протоколы, ошибки",
  specialties: ["Травматология"],
  speakers: [{ name: "Анна Крылова", org: "НМИЦ травматологии" }],
};

/**
 * 021 EARS-2 (#2455) — the canvas `auth` draws the return-context card on
 * «Вход», «Регистрация» and «Подтверждение» for BOTH hosts, gated on the return
 * context alone; it is the package's behaviour, never a host flag.
 */
describe("ACADEMY_AUTH_FLOW: the return-context card", () => {
  it.each(["login", "register"] as const)(
    "021 EARS-2 (#2455): the carried эфир is drawn beside the %s door on this host, with no host flag",
    (variant) => {
      expect(ACADEMY_AUTH_FLOW).not.toHaveProperty(["returnTo", "card"]);
      const slots = returnContextSlots({
        config: ACADEMY_AUTH_FLOW,
        event: RETURN_EVENT,
        variant,
      });
      expect(slots.panel).toBeDefined();
      expect(slots.plate).toBeDefined();
    },
  );
});

describe("ACADEMY_AUTH_FLOW — the registration door this host mounts", () => {
  it("003 EARS-24: this host serves the confirmation step on its own `/verify` route", () => {
    // 003 EARS-24 — the registration door hops here after the ack.
    expect(config.routes.verify).toBe("/verify");
  });

  it("003 EARS-20: ONE required Terms-of-Service tier, at the canonical wording version", () => {
    const items = (config.consents?.tiers ?? []).flatMap((tier) => tier.items);
    expect(items).toHaveLength(1);
    expect(items[0]?.purpose).toBe("tos");
    expect(items[0]?.required).toBe(true);
    expect(config.consents?.wordingVersion).toBe("2026-01");
  });

  it("003 EARS-20: the acceptance is READ as one sentence, never a checkbox group", () => {
    // Both halves name the same purpose: the statement is what the visitor
    // reads, the tier item is what is recorded.
    const items = (config.consents?.tiers ?? []).flatMap((tier) => tier.items);
    expect(resolveAuthFlowCopy(config).consents.statement).toBe(
      items[0]?.statement,
    );
    // No row copy ⇒ the door renders no consent CONTROL on this host.
    expect(config.consents?.medicalWorkerDeclaration).toBeUndefined();
    expect(config.consents?.partnerDataItem).toBeUndefined();
    expect(config.consents?.marketingOptIn).toBeUndefined();
  });

  it("003 EARS-20: this host declares nothing the doctor storefront declares", () => {
    // The medical-worker declaration, the partner-data and marketing rows, the
    // attribution line and the points promise are the doctor door's 021
    // decisions; an honest empty is how they stay off this screen.
    expect(config.register.attribution).toBeUndefined();
    expect(config.register.pointsPromise).toBeUndefined();
    expect(config.register.promoField).toBe(false);
  });

  it("#1934: the shipped Academy render IS the block's own composition", () => {
    // The block draws ONE registration composition now (#2027, the owner's
    // canvas), so a host states no icon and nothing about form order or rhythm.
    expect(config.brand.registerIcon).toBeUndefined();
  });

  it("#2331: the door names its way back to the sign-in door", () => {
    expect(resolveAuthFlowCopy(config).register.haveAccount).toBe(
      "Уже есть аккаунт? Войти",
    );
  });

  it("#2027: the brand panel is the Academy's own — eyebrow, headline, sub-copy, footer (owner 2026-09-24)", () => {
    expect(resolveAuthFlowCopy(config).brand).toEqual({
      eyebrow: "Академия Doctor.School",
      headline: "Среда обитания экспертов здравоохранения",
      subcopy:
        "Эфиры, программы и сертификация от практикующих экспертов — в одном пространстве.",
      footer: "© Doctor.School.",
    });
  });

  it("#2027: the host restates no other auth wording — every other sentence is the package's", () => {
    expect(Object.keys(ACADEMY_AUTH_FLOW.copy ?? {})).toEqual(["brand"]);
    const resolved = resolveAuthFlowCopy(config);
    for (const key of Object.keys(DEFAULT_AUTH_FLOW_COPY)) {
      if (key === "brand") continue;
      expect(resolved[key as keyof typeof resolved]).toBe(
        DEFAULT_AUTH_FLOW_COPY[key as keyof typeof DEFAULT_AUTH_FLOW_COPY],
      );
    }
  });
});
