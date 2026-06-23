// #269 REGRESSION FIXTURE (layer-2 JS/TSX). This styled clickable's ONLY
// hover:* and focus-visible:* tokens live inside comments — the live className
// carries neither. A guard that does not strip JS/TS comments before its scan
// would match the commented tokens and false-PASS (the recurrence of the #269
// bug in the layer-2 scan). The guard MUST still FAIL here.
//
// intended states (commented out, NOT live): hover:bg-primary-hover focus-visible:ring-2
import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  // hover:bg-primary-hover focus-visible:ring-ring  <- also only in a comment
  "inline-flex items-center",
);

export function Button(props: { className?: string }) {
  return <button className={buttonVariants()} {...props} />;
}
