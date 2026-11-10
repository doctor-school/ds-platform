import type { FeedValueBlock } from "@ds/schemas";

/** Canvas labels (`design-source/doctor-feed.dc.html`, «d-feed · зачем это мне»). */
const COPY = {
  eyebrow: "Ценность",
  heading: "Зачем это мне",
} as const;

/**
 * 018 EARS-7 (#1502) — «Зачем это мне». The items and the closing statement
 * are the envelope's editorial copy (018-design §1: no read, no error state),
 * so the block renders exactly what it is given.
 *
 * The canvas closing strip carries two more sentences; LD-9 keeps only the
 * statement — the strip is that one line, with nothing beside it.
 */
export function SpecialtyFeedValueBlock({ block }: { block: FeedValueBlock }) {
  return (
    <section
      aria-labelledby="specialty-feed-value-heading"
      className="mt-12 px-4 layout:mt-20 layout:px-12"
      data-feed-kind="value"
      data-screen-label="d-feed · зачем это мне"
      data-testid="specialty-feed-value"
    >
      <div className="mx-auto w-full max-w-content">
        <p className="mb-2.5 text-xs font-extrabold uppercase tracking-widest text-primary-action">
          {COPY.eyebrow}
        </p>
        <h2
          id="specialty-feed-value-heading"
          className="mb-5 text-2xl font-extrabold leading-none tracking-tight text-foreground layout:mb-8 layout:text-4xl"
        >
          {COPY.heading}
        </h2>
        <ul
          className="grid grid-cols-1 gap-0.5 border-2 border-hairline bg-hairline layout:grid-cols-4 layout:border-border layout:bg-border layout:shadow-lg"
          data-testid="specialty-feed-value-items"
        >
          {block.items.map((item) => (
            <li
              className="bg-card p-5 layout:p-6"
              data-testid="specialty-feed-value-item"
              key={item.title}
            >
              <h3 className="text-base font-extrabold tracking-tight text-card-foreground">
                {item.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
        <p
          className="mt-0.5 bg-tint px-5 py-4 text-sm font-extrabold text-tint-foreground"
          data-testid="specialty-feed-value-free"
        >
          {block.freeStatement}
        </p>
      </div>
    </section>
  );
}
