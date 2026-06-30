// Defect (#396): a hand-typed string constant DEPICTING the import line a consumer
// would write — `from "@ds/design-system"` typed INSIDE a string literal (not a real
// executable import). A hand-maintained copy of the package's public API that drifts.
// The guard must flag this (exit 1).
const USAGE_IMPORT = 'import { AuthCard } from "@ds/design-system/blocks";';

export function Usage() {
  return <pre>{USAGE_IMPORT}</pre>;
}
