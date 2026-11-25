"use client";

import { useEffect, useRef } from "react";

import { Button } from "@ds/design-system/button";

import { applicationsCopy as copy } from "../copy";

/**
 * 033 EARS-9 — «Заявка отправлена» in place of the form: the administrator
 * reviews it and gets in touch, the «Заявка получена» letter comes to the
 * account's email, and «Отправить ещё одну заявку — про другой проект» opens
 * an empty form with a new idempotency key. The heading takes focus, so the
 * replaced form does not leave keyboard focus on a removed control.
 */
export function SentState({ onAnother }: { onAnother: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div
      data-testid="apply-sent"
      className="border-2 border-border bg-card p-6 shadow-lg md:p-9"
    >
      <span
        aria-hidden="true"
        className="mb-5 inline-flex size-13 items-center justify-center bg-success-tint text-xl font-extrabold text-success"
      >
        ✓
      </span>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-title-lg font-extrabold leading-title tracking-tight text-foreground focus-visible:outline-none"
      >
        {copy.sent.title}
      </h2>
      <p className="mt-3 text-sm leading-assurance text-muted-foreground">
        {copy.sent.text}
      </p>
      <Button
        type="button"
        variant="link"
        className="mt-5 p-0 text-caption text-muted-foreground underline decoration-2 underline-offset-4"
        onClick={onAnother}
      >
        {copy.sent.another}
      </Button>
    </div>
  );
}
