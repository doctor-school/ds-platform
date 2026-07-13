/**
 * 006 EARS-15 — derive the header-avatar initials from a doctor's REAL saved
 * display name. First letter of the FIRST word + first letter of the LAST word,
 * uppercased; a single-word name yields one initial. NEVER fabricated from an
 * email or placeholder — the caller renders no avatar when there is no saved name
 * (design §11), so this helper is only ever handed a real name; the empty-string
 * return is the defensive floor, not a rendered path.
 *
 * `Array.from(word)[0]` takes the first GRAPHEME (surrogate-safe — a name whose
 * first character is an astral codepoint keeps its whole glyph, never a lone
 * surrogate half), and `.toUpperCase()` uppercases correctly for Cyrillic.
 */
export function initialsFromDisplayName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const first = Array.from(words[0])[0] ?? "";
  if (words.length === 1) return first.toUpperCase();

  const last = Array.from(words[words.length - 1])[0] ?? "";
  return (first + last).toUpperCase();
}
