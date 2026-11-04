#!/usr/bin/env node
// Issue #3662: the steps of recovery-custody.yml (lib/recovery-custody.mjs).
//
//   node tools/deploy/recovery-custody.mjs verb <event> <schedule> <input-verb>
//       → appends `verb=<verb>` to $GITHUB_OUTPUT
//   node tools/deploy/recovery-custody.mjs status <verb> <rc> <stdout-file> <stderr-file>
//       → the status lines only; exit 1 unless every box answered its success word

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  RECOVERY_VERBS,
  recoveryReport,
  scheduledVerb,
} from "./lib/recovery-custody.mjs";

// Pinned equal to the workflow's `on.schedule` by the tests.
export const CRONS = { bundle: "17 3 * * 1", check: "23 4 * * *" };

export function main(argv, { output = process.env.GITHUB_OUTPUT } = {}) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "verb": {
      const [event, schedule, input] = rest;
      const verb =
        event === "schedule" ? scheduledVerb(schedule, CRONS) : input;
      if (!RECOVERY_VERBS.includes(verb)) {
        console.log(
          `::error::recovery-custody: no recovery verb for ${event} ${JSON.stringify(schedule || input)}`,
        );
        return 1;
      }
      if (output) appendFileSync(output, `verb=${verb}\n`);
      console.log(`recovery-custody: verb ${verb}`);
      return 0;
    }
    case "status": {
      const [verb, rc, outFile, errFile] = rest;
      const read = (f) => {
        try {
          return readFileSync(f, "utf8");
        } catch {
          return "";
        }
      };
      const r = recoveryReport({
        verb,
        rc: Number(rc),
        stdout: read(outFile),
        stderr: read(errFile),
      });
      for (const line of r.lines) console.log(line);
      if (!r.ok)
        console.log(
          `::error::recovery-custody: ${verb} did not pass on both boxes`,
        );
      return r.ok ? 0 : 1;
    }
    default:
      console.error("usage: recovery-custody.mjs verb|status");
      return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
