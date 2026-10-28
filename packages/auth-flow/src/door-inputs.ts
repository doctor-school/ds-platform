/**
 * #3345 — the ONE door-input contract: every input a door's route reads from
 * its URL, and where each one comes from on each of the door's two mounts.
 *
 * On BOTH mounts a door gets its props from the same `*-route.tsx` code; the
 * only thing that differs is the `searchParams` object the route is fed:
 *
 * - the STOREFRONT mount feeds the browser's own URL;
 * - the SIGN-IN HOST mount (`SignInHostRoute`) feeds what
 *   `signInHostSearchParams` builds from the API's entry answer (003 EARS-71).
 *
 * Each input is classified once, here:
 *
 * - `both` — the host carries the browser's value through, like the
 *   storefront does;
 * - `host-intent` — the host feeds it from the resolved entry intent instead
 *   of the browser (ADR-0015 §4 step 3: nothing is taken from a URL
 *   parameter);
 * - `storefront-only` — the host never feeds it, for the named clause.
 *
 * Each route reads its inputs ONLY through `readDoorInputs`, and the host's
 * params are typed `SignInHostDoorParams`, so an input added to a route
 * without a classification here is a type error, and an input the host stops
 * feeding is a red mount-parity test (`door-mount-parity.test.tsx`).
 */

import { LOGIN_HANDOFF_PARAM } from "./login/login-handoff";
import { RETURN_CONTEXT_PARAM } from "./return-context-href";

export type DoorInputSource = "both" | "host-intent" | "storefront-only";

export type DoorInputSpec =
  | { readonly param: string; readonly source: "both" }
  | {
      readonly param: string;
      readonly source: "host-intent";
      /** The entry-intent field the host derives the input from. */
      readonly from: string;
    }
  | {
      readonly param: string;
      readonly source: "storefront-only";
      /** The ADR-0015 / 003 clause that keeps the host from feeding it. */
      readonly clause: string;
    };

export const DOOR_INPUTS = {
  login: {
    returnTo: {
      param: RETURN_CONTEXT_PARAM,
      source: "host-intent",
      from: "intent.eventTarget",
    },
    // 003 EARS-43 — the method the card opens on.
    method: { param: "method", source: "host-intent", from: "intent.method" },
    // 003 EARS-44 — the Congress hand-off reference.
    handoff: {
      param: LOGIN_HANDOFF_PARAM,
      source: "storefront-only",
      clause:
        "003 EARS-71 / ADR-0015 §4: the reference never leaves the API (it is redeemed server-side); the host's intent says only that one rides it (`intent.handoff` → `api.formPost.handoff`)",
    },
  },
  register: {
    returnTo: {
      param: RETURN_CONTEXT_PARAM,
      source: "host-intent",
      from: "intent.eventTarget",
    },
  },
  reset: {
    returnTo: {
      param: RETURN_CONTEXT_PARAM,
      source: "storefront-only",
      clause:
        "ADR-0015 §4 step 3: the return path lives in the server-side transaction and the sign-in host never chooses a landing; the reset door draws no return-context card",
    },
  },
  verify: {
    returnTo: {
      param: RETURN_CONTEXT_PARAM,
      source: "host-intent",
      from: "intent.eventTarget",
    },
    // The address the registration door hands its code step (003 EARS-24/40).
    email: { param: "email", source: "both" },
  },
} as const satisfies Record<string, Record<string, DoorInputSpec>>;

export type DoorInputDoor = keyof typeof DOOR_INPUTS;

type DoorInputContract<D extends DoorInputDoor> = (typeof DOOR_INPUTS)[D];

/** A door's inputs as its route reads them: the FIRST value of each param. */
export type DoorInputs<D extends DoorInputDoor> = {
  readonly [K in keyof DoorInputContract<D>]: string | undefined;
};

type HostFedKey<D extends DoorInputDoor> = {
  [K in keyof DoorInputContract<D>]: DoorInputContract<D>[K] extends {
    source: "storefront-only";
  }
    ? never
    : K;
}[keyof DoorInputContract<D>];

type ParamOf<D extends DoorInputDoor, K extends keyof DoorInputContract<D>> =
  DoorInputContract<D>[K] extends { param: infer P extends string } ? P : never;

/**
 * The search params the sign-in host feeds door `D`: only its `both` and
 * `host-intent` inputs, by param name. A `storefront-only` param is not a key.
 */
export type SignInHostDoorParams<D extends DoorInputDoor> = {
  [K in HostFedKey<D> as ParamOf<D, K>]?: string;
};

export type DoorSearchParams = Record<string, string | string[] | undefined>;

/**
 * The door's inputs read through the contract. A repeated param arrives as an
 * array; the FIRST value wins rather than the request being rejected — a
 * malformed input degrades to no input, it never breaks the door.
 */
export function readDoorInputs<D extends DoorInputDoor>(
  door: D,
  params: DoorSearchParams,
): DoorInputs<D> {
  const contract: Record<string, DoorInputSpec> = DOOR_INPUTS[door];
  const inputs: Record<string, string | undefined> = {};
  for (const [key, spec] of Object.entries(contract)) {
    const raw = params[spec.param];
    inputs[key] = Array.isArray(raw) ? raw[0] : raw;
  }
  return inputs as DoorInputs<D>;
}
