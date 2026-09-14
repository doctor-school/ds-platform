import { Given } from "./support/fixtures.js";
import { signInGoldenDoctor } from "../lib/sign-in.js";

/**
 * GOLDEN-ENTITY steps — staging/regression-contour tech spec §6.1: every scenario
 * names golden entities BY THEIR SEED NAME (`Given the golden doctor
 * "verified-cardiologist" is signed in`), never by hand-typed data. The seed name
 * is resolved through `lib/golden.ts`, the one registry that knows which `@ds/db`
 * golden account a name denotes and which env var carries its IdP password.
 *
 * The sign-in itself is `lib/sign-in.ts` — the one login path this package owns,
 * shared with the derived navigation walk's doctor pass so the scenario suite and
 * the walk can never drift into two different notions of «signed in».
 */
Given(
  "the golden doctor {string} is signed in",
  async ({ page, world }, seedName: string) => {
    const doctor = await signInGoldenDoctor(page, world.host, seedName);
    world.signedInAs = doctor.seedName;
  },
);
