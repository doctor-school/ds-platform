// Green fixture: a styled clickable primitive that satisfies the contract —
// a hover affordance plus a visible keyboard focus (composing interactiveBase).
import { cva } from "class-variance-authority";

import { interactiveBase } from "./interactive-base";

export const buttonVariants = cva(
  cn(interactiveBase, "inline-flex items-center hover:bg-primary-hover"),
);

export function Button(props: { className?: string }) {
  return <button className={buttonVariants()} {...props} />;
}
