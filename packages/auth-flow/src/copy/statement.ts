import type { AuthFlowConsentRowCopy } from "../host-config";

/**
 * The statement a consent RECORD stores for a row, composed from the very copy
 * the door RENDERS for it (021 EARS-5 / EARS-7, ADR-0009).
 *
 * A consent record is only meaningful while its `statement` is the text the
 * doctor actually read. Writing that text a second time beside the host's
 * flags — the shape #2027 replaced — lets the render move and the record stand
 * still, so a row ends up claiming wording no visitor ever saw. Both halves go
 * through this one composition instead: label first, then the help line under
 * it, the order the canvas draws them (`design-source/auth.dc.html`,
 * `#d-register`, «согласия · вариант Б»).
 */
export const consentStatementOf = (
  row: Pick<AuthFlowConsentRowCopy, "label" | "help">,
): string => (row.help === "" ? row.label : `${row.label} ${row.help}`);
