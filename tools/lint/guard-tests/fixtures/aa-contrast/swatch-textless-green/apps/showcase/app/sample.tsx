// A tokens-view colour specimen: a text-LESS `bg-primary` swatch (incl. an opacity
// tint `bg-primary/20`) carries no text, so AA does not apply — the guard must NOT
// flag it (exit 0). This is the key pass case distinguishing a swatch from a fill.
export function Sample() {
  return (
    <div>
      <div className="h-12 w-12 rounded bg-primary" aria-hidden />
      <div className="h-2 bg-primary/20" aria-hidden />
    </div>
  );
}
