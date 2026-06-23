// RED: hover is present but there is NO visible keyboard focus — neither a
// focus-visible:* class nor a compose of interactiveBase. The guard must flag
// the missing focus contract.
import { cva } from "class-variance-authority";

export const buttonVariants = cva("inline-flex items-center hover:bg-primary-hover");

export function Button(props: { className?: string }) {
  return <button className={buttonVariants()} {...props} />;
}
