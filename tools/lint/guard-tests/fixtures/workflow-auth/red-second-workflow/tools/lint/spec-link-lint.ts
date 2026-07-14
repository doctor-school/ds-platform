// fixture marker — a PR-event-gated `gh` consumer. The `./lib/gh` import is what
// workflow-auth-lint.ts greps for to DERIVE the gh-consumer set.
import { ghViewJson } from "./lib/gh";
void ghViewJson;
