import type { LearningRulesAuthority, LearningScopeKind } from "@ds/schemas";

import { RULES_COPY as R } from "./admin-copy";

// 024 EARS-30 — what the admin screens draw from a scope's authority. It
// mirrors the server's check (`assertRulesAuthority`), which stays the one that
// refuses: a staff member without the role sees the rules read-only.

/** The role a scope's authority takes. */
export const AUTHORITY_ROLE: Record<LearningRulesAuthority, string> = {
  "rules-editor": "learning_rules_editor",
  "course-editor": "platform_admin",
};

/** Why the scope is read-only for these roles; null = they may change it. */
export function readOnlyReason(
  kind: LearningScopeKind,
  authority: LearningRulesAuthority,
  staffRoles: readonly string[],
): string | null {
  if (staffRoles.includes(AUTHORITY_ROLE[authority])) return null;
  if (authority === "course-editor") return R.readOnly.draft;
  return kind === "platform" ? R.readOnly.platform : R.readOnly.published;
}
