// Green primitive — isolates the failure to the layer-1 CSS comment mask.
import { cva } from "class-variance-authority";

import { interactiveBase } from "./interactive-base";

export const buttonVariants = cva(
  cn(interactiveBase, "inline-flex items-center hover:bg-primary-hover"),
);

export function Button(props: { className?: string }) {
  return <button className={buttonVariants()} {...props} />;
}
