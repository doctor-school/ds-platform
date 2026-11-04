import NextLink from "next/link";
import { EmptyState } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";

/**
 * 018 EARS-1 — a feed path naming no specialty of the book: an honest
 * statement and the way to the specialty choice, never a crash or an empty
 * page.
 */
export default function SpecialtyFeedNotFound() {
  return (
    <section
      className="px-4 py-16 layout:px-12 layout:py-24"
      data-testid="specialty-feed-not-found"
    >
      <div className="mx-auto w-full max-w-content">
        <EmptyState
          variant="no-records"
          title="Такой специальности нет"
          description="Адрес ленты не совпадает ни с одной специальностью из списка."
          action={
            <Button asChild>
              <NextLink href="/">Выбрать специальность</NextLink>
            </Button>
          }
        />
      </div>
    </section>
  );
}
