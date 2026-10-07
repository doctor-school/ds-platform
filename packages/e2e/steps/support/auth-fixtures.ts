import { createBdd } from "playwright-bdd";
import { test as base } from "./fixtures.js";

// Authentication responses and mail carry secrets; keep them out of persisted
// traces. bddgen selects this derived test only for the feature using its steps.
export const test = base.extend({ trace: "off" });
export const { Given, When, Then, After } = createBdd(test);
