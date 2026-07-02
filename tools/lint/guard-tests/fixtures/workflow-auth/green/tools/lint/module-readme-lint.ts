// fixture marker — a STATIC guard, NOT a gh consumer (no `./lib/gh` import), so
// the derive scan must EXCLUDE it and a job running it is not gh-gated.
export {};
