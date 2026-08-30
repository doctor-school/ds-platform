#!/usr/bin/env tsx
/** Pre-merge phase: require the latest Mode (a) canvas comparison artifact. */
import { runUiParityGuard } from "./ui-parity-lint";

process.env.UI_PARITY_REQUIRE_REVIEW = "1";
runUiParityGuard().catch((error) => {
  process.stderr.write(
    `[ui-parity] ${(error as Error).stack ?? String(error)}\n`,
  );
  process.exit(1);
});
