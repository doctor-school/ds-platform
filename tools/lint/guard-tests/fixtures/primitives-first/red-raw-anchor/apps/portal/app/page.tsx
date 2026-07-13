/**
 * RED: a raw `<a>` carrying a bespoke hover stack — the states belong to the
 * `@ds/design-system` `Link` primitive.
 */
export default function Page() {
  return (
    <a href="/account" className="underline hover:opacity-80 focus-visible:shadow-focus">
      Edit
    </a>
  );
}
