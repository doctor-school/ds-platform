import { Inject, Injectable } from "@nestjs/common";
import type { SpecialtyMinzdrav } from "@ds/db";
import type {
  FrequentSpecialties,
  SpecialtyBook,
  SpecialtyRef,
  SpecialtySearchResult,
} from "@ds/schemas";
import { specialtyNameMatchesQuery } from "@ds/schemas";
import { SpecialtyError } from "./specialties.errors.js";
import { SpecialtiesRepository } from "./specialties.repository.js";

// 017 EARS-3 (#1479) — the read side of the closed Минздрав specialty reference
// book plus the membership mechanism every specialty-accepting path consumes.
//
// The book has NO write path (017-design §2): this service exposes reads and one
// membership check, and there is deliberately no create/update/delete method for
// a controller to reach for later.

/** Project a stored row onto the single wire shape (`SpecialtyRef`). */
function toRef(row: SpecialtyMinzdrav): SpecialtyRef {
  return {
    id: row.id,
    code: row.code,
    // Verbatim nomenclature wording — never normalized, glossed or abbreviated.
    name: row.name,
    isOther: row.isOther,
  };
}

@Injectable()
export class SpecialtiesService {
  constructor(
    @Inject(SpecialtiesRepository)
    private readonly specialties: SpecialtiesRepository,
  ) {}

  /**
   * The full book. `total` is computed from what this read actually serves, not
   * from a stored counter and never from a literal: every count surface binds to
   * `SpecialtyBook.total`, so the number a doctor sees can only ever be the
   * number of entries they can actually choose from (017-design §7).
   */
  async book(): Promise<SpecialtyBook> {
    const entries = (await this.specialties.findAll()).map(toRef);
    return { entries, total: entries.length };
  }

  /**
   * The frequent set — an ordered SUBSET of the same book, never a second book.
   * It carries no `total`: it is a presentation shortcut, and a count taken from
   * it would not be the size of the book.
   */
  async frequent(): Promise<FrequentSpecialties> {
    const entries = (await this.specialties.findFrequent()).map(toRef);
    return { entries };
  }

  /**
   * The catalog search read (EARS-5): the whole book narrowed by the SHARED
   * matching rule — substring anywhere in the name, case- and «ё/е»-insensitive.
   *
   * It narrows over the WHOLE book, «Другое» included, never over the frequent
   * subset: the frequent set is a presentation shortcut, and searching it would
   * make most of a closed legal reference book unreachable by typing.
   *
   * The filter is applied HERE, in TypeScript, over the same rows `book()`
   * serves, rather than pushed into SQL. That is deliberate and not a shortcut:
   * the fold is one rule shared with the storefront through `@ds/schemas`, and a
   * `LIKE`/`ILIKE` predicate would re-express it in Postgres collation semantics
   * that do NOT fold «ё» onto «е» — two rules, drifting, over a book of a
   * hundred-odd short rows where the scan costs nothing. If the book ever stops
   * being closed and small, the rule moves into the database WITH the fold, not
   * the fold into the database's approximation of it.
   *
   * A no-match is an empty result, never an error: EARS-5 requires the query to
   * stay editable and the search recoverable.
   */
  async search(query: string): Promise<SpecialtySearchResult> {
    const entries = (await this.specialties.findAll())
      .map(toRef)
      .filter((entry) => specialtyNameMatchesQuery(entry.name, query));
    return { query, entries, total: entries.length };
  }

  /**
   * The closed-book membership mechanism (EARS-3), fail-closed.
   *
   * Every path that accepts a specialty reference — the choose-specialty handler
   * of #1481/#1482 included — resolves it through here FIRST and works with the
   * returned row, so a non-member can be neither coerced to a nearby entry nor
   * created on the fly. A reference that names no row is refused with the stable
   * `SPECIALTY_NOT_IN_BOOK` code (422 RFC 7807 via `SpecialtyProblemFilter`); the
   * refusal repeats no database key and no submitted value.
   */
  async resolveMember(reference: string): Promise<SpecialtyRef> {
    const row =
      typeof reference === "string" && reference.length > 0
        ? await this.specialties.findByIdOrCode(reference)
        : null;
    if (!row) throw new SpecialtyError("SPECIALTY_NOT_IN_BOOK");
    return toRef(row);
  }
}
