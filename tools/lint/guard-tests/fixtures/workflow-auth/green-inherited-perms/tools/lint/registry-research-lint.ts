// fixture marker — a second `gh` consumer, reached in ci.yml via its
// `pnpm lint:registry-research` package.json alias (the alias-detection path).
import { ghViewJson } from "./lib/gh";
void ghViewJson;
