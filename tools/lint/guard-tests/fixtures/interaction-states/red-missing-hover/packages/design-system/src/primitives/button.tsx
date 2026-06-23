// RED: focus is satisfied (composes interactiveBase) but there is NO hover:* —
// the guard must flag the missing hover affordance.
import { cva } from "class-variance-authority";

import { interactiveBase } from "./interactive-base";

export const buttonVariants = cva(cn(interactiveBase, "inline-flex items-center"));

export function Button(props: { className?: string }) {
  return <button className={buttonVariants()} {...props} />;
}
