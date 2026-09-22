// Vitest setupFile — runs in EVERY test file's environment, before the file.
//
// 044 EARS-7: the congress intake pads every response to a route-specific
// timing floor whose PRODUCTION default is one second, and three suites drive
// that route (the intake itself, the abuse suite's 62 sequential submissions,
// the roster's possible-duplicate submissions). At the production floor those
// suites spend minutes of pure deterministic sleep and prove nothing the
// interceptor unit spec does not already prove: what an e2e asserts here is the
// response BODY parity, not the latency parity. The floor therefore belongs to
// the RUNNER, once, rather than to whichever suite happened to remember it.
//
// `??=`, not `=`: a suite that deliberately configures its own floor still wins
// inside its own file, and a suite that deletes the key in `afterAll` cannot
// take the default away from the file that runs next in the same worker.
process.env["CONGRESS_SIGNUP_TIMING_FLOOR_MS"] ??= "5";

// 044 EARS-13: the venue is a required deployment constant of the congress, so
// `resolveCongressSignUpSettings` refuses every submission without it. The
// three suites that drive the intake care about the OTHER settings, and the one
// suite that asserts the mail copy sets its own venue in `beforeAll` - so the
// runner supplies a neutral default the same way it supplies the floor.
process.env["CONGRESS_SIGNUP_EVENT_VENUE"] ??= "Москва, тестовая площадка";

