#!/usr/bin/env node
// Issue #3662: the steps of recovery-custody.yml (lib/recovery-custody.mjs).
//
//   node tools/deploy/recovery-custody.mjs verb <event> <schedule> <input-verb>
//       → appends `verb=<verb>` and `run=true|false` to $GITHUB_OUTPUT; a scheduled
//         run before the custodian ceremony (no recipient line at all) is run=false
//   node tools/deploy/recovery-custody.mjs status <verb> <rc> <stdout-file> <stderr-file>
//       → the status lines only; exit 1 unless every box answered its success word

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  custodianGate,
  MIN_RECIPIENTS,
  RECOVERY_VERBS,
  recoveryReport,
  scheduledVerb,
} from "./lib/recovery-custody.mjs";

// Pinned equal to the workflow's `on.schedule` by the tests.
export const CRONS = { bundle: "17 3 * * 1", check: "23 4 * * *" };

const CUSTODIANS = fileURLToPath(
  new URL("../../infra/deploy/recovery/custodians.txt", import.meta.url),
);

export function main(
  argv,
  {
    output = process.env.GITHUB_OUTPUT,
    summary = process.env.GITHUB_STEP_SUMMARY,
    custodians = CUSTODIANS,
  } = {},
) {
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
      // Before the ceremony the box refuses every verb, so a schedule would go red
      // daily (#3662 decision-debt (a)). Only a file with no recipient line at all is
      // that state: any line, valid or not, means the ceremony happened and the box
      // gate must judge it, red when broken. A dispatch always reaches the box.
      let text = "";
      try {
        text = readFileSync(custodians, "utf8");
      } catch {
        // No file: no recipient line, the same verdict as the box's.
      }
      const { count, invalid } = custodianGate(text);
      const run = event !== "schedule" || count + invalid > 0;
      if (output) appendFileSync(output, `verb=${verb}\nrun=${run}\n`);
      console.log(`recovery-custody: verb ${verb}`);
      if (!run) {
        const line = `recovery-custody: ${verb} skipped, custodians.txt holds no recipient line (${MIN_RECIPIENTS} required): custodian ceremony pending (#3662)`;
        console.log(`::notice::${line}`);
        if (summary) appendFileSync(summary, `${line}\n`);
      }
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
