/**
 * RED: a raw `<button>` with a bespoke state stack. The arrow function in the
 * attribute BEFORE `className` is the regression trap: a bounded `[^>]*` tag
 * matcher truncates at the `>` of `=>` and never sees the className — the
 * brace-aware scanner must still flag this.
 */
export default function Page() {
  return (
    <button
      type="button"
      onClick={() => console.log("send")}
      className="text-sm font-extrabold hover:bg-muted focus-visible:shadow-focus"
    >
      Send
    </button>
  );
}
