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
