"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";

/**
 * 018 — the feed envelope could not be read: the reason in Russian and
 * «Повторить», which re-renders this segment. A failing BLOCK never reaches
 * here — each block states its own failure in place.
 */
export default function SpecialtyFeedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <section
      className="px-4 py-16 layout:px-12 layout:py-24"
      data-testid="specialty-feed-error"
      role="alert"
    >
      <div className="mx-auto w-full max-w-content">
        <EmptyState
          variant="no-records"
          title="Не удалось загрузить ленту специальности"
          description="Сервер не ответил. Проверьте соединение и попробуйте снова."
          action={
            <Button
              aria-busy={pending || undefined}
              aria-disabled={pending || undefined}
              onClick={pending ? undefined : retry}
            >
              Повторить
            </Button>
          }
        />
      </div>
    </section>
  );
}
