"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { MaterialArticle } from "@ds/design-system/material-article";

/**
 * 048 EARS-12 (#3514) — a failed material read is the canvas error state
 * (`design-source/academy-material.dc.html`, `state` ошибка): «Повторить»
 * re-runs the server read (`router.refresh`) and re-renders this segment.
 */
export default function MaterialReadError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <MaterialArticle
      state="error"
      backHref="/#feed-h"
      retrying={pending}
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}
