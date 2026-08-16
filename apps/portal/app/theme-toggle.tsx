"use client";

import { useEffect, useState } from "react";
import { Button } from "@ds/design-system/button";

/** The page theme is the `.dark` class consumed by design-system tokens. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
    </Button>
  );
}
