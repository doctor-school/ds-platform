// An ISO timestamp regex: `\d:\d` is an escape sequence, not a drive root.
export const STAMP_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
