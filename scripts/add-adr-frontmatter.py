"""One-shot: add YAML frontmatter (title, description, lang) to ADR files.

Reads each .md file under apps/docs/content/adr/, derives:
  - title from the first H1 (with [EN]/[RU] suffix from filename)
  - description from the first prose paragraph after the H1
    (skipping `**Key:** value` metadata lines)
  - lang from filename suffix (-en.md / -ru.md)

Preserves existing bilingual link (relocated AFTER frontmatter) and rest
of content unchanged. Idempotent: skips files that already start with `---`.
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ADR_DIR = Path(__file__).resolve().parent.parent / "apps" / "docs" / "content" / "adr"

METADATA_LINE = re.compile(r"^\s*\*\*[^*]+:\*\*")  # **Date:** ..., **Status:** ...
H1 = re.compile(r"^#\s+(.+?)\s*$")


def truncate(s: str, n: int = 150) -> str:
    s = s.strip()
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0]
    return cut + "..."


def yaml_escape(s: str) -> str:
    # Double-quoted YAML: escape backslash and double-quote.
    return s.replace("\\", "\\\\").replace('"', '\\"')


def process(path: Path) -> tuple[str, str] | None:
    text = path.read_text(encoding="utf-8")
    if text.startswith("---\n"):
        return None  # already has frontmatter

    lang = "ru" if path.stem.endswith("-ru") else "en"
    lang_tag = "[RU]" if lang == "ru" else "[EN]"

    lines = text.splitlines()
    bilingual = None
    i = 0
    # Capture leading bilingual link block (one `>` line + blank).
    if i < len(lines) and lines[i].lstrip().startswith(">"):
        bilingual = lines[i]
        i += 1
        while i < len(lines) and lines[i].strip() == "":
            i += 1

    # Find H1.
    h1_text = None
    while i < len(lines):
        m = H1.match(lines[i])
        if m:
            h1_text = m.group(1).strip()
            i += 1
            break
        i += 1
    if h1_text is None:
        print(f"  WARN: no H1 in {path.name}; skipping")
        return None

    # Find first prose paragraph after H1, skipping blanks, metadata lines,
    # horizontal rules, and section headings.
    desc = ""
    while i < len(lines):
        ln = lines[i].rstrip()
        if (
            ln == ""
            or ln.startswith("---")
            or ln.startswith("#")
            or METADATA_LINE.match(ln)
        ):
            i += 1
            continue
        # Collect this paragraph (one or more non-blank lines).
        para = [ln]
        i += 1
        while i < len(lines) and lines[i].strip() != "":
            para.append(lines[i].rstrip())
            i += 1
        desc = " ".join(para).strip()
        # Strip markdown emphasis markers for cleaner description.
        desc = re.sub(r"\*\*([^*]+)\*\*", r"\1", desc)
        desc = re.sub(r"\*([^*]+)\*", r"\1", desc)
        desc = re.sub(r"`([^`]+)`", r"\1", desc)
        if desc:
            break

    desc = truncate(desc, 150) if desc else ""

    title = f"{h1_text} {lang_tag}"

    fm_lines = ["---", f'title: "{yaml_escape(title)}"']
    if desc:
        fm_lines.append(f'description: "{yaml_escape(desc)}"')
    fm_lines.append(f"lang: {lang}")
    fm_lines.append("---")
    frontmatter = "\n".join(fm_lines) + "\n\n"

    rest = "\n".join(lines) + ("\n" if text.endswith("\n") else "")
    new_text = frontmatter + rest

    path.write_text(new_text, encoding="utf-8", newline="\n")
    return title, desc


def main() -> int:
    files = sorted(ADR_DIR.glob("*.md"))
    print(f"Found {len(files)} files in {ADR_DIR}")
    updated = 0
    for p in files:
        result = process(p)
        if result is None:
            print(f"  skip: {p.name}")
            continue
        title, desc = result
        updated += 1
        print(f"  ok:   {p.name}")
        print(f"        title: {title}")
        if desc:
            print(f"        desc:  {desc[:80]}{'...' if len(desc) > 80 else ''}")
    print(f"\nUpdated {updated}/{len(files)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
