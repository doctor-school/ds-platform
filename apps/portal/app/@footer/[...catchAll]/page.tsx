/**
 * Every non-root route: no page footer of its own (the shared storefront
 * footer closes those documents). Without this match a soft navigation away
 * from `/` would keep the home footer mounted in the unmatched slot.
 */
export default function NoPageFooter() {
  return null;
}
