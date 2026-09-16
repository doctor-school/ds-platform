---
"@ds/db": minor
---

#2213 — the golden dataset gains every remaining admin family and the targeting
chain that carries an эфир to a doctor.

`taxonomy.ts` is a new authored catalogue: 41 directions (38 `published`, 2
`draft`, 1 `retired`), 14 partners across the same three states, and 77 weighted
adjacency edges between the published directions. The 118 `Раздел I` specialties
of the Минздрав book are PARTITIONED over those directions, and the
`event_directions` walk sweeps the published directions contiguously, so at any
pin a doctor who picks any specialty of the book reaches an upcoming published
эфир — the invariant a feed that renders empty behind healthy-looking counts
violates. `project_experts` and `project_partners` complete the admin nav: one
active curator per project, at most one primary partner.

New exports: the `taxonomy.ts` catalogue, `resolveDirectionSpecialtyRows`
(maps authored specialty names onto the seeded book's ids and fails loudly on a
name it does not carry), `goldenDirectionId`, `goldenPartnerId`,
`partnerLogoKey` / `ordinalFromPartnerLogoKey`, `renderPartnerLogoSvg` and
`PARTNER_LOGO_CONTENT_TYPE`. Every partner row now names a logo object, and the
media plan generates it: a deterministic inline-SVG wordmark derived from the
partner's own title and ordinal, written `if-absent` like a committed portrait
because nothing in it moves with the pin.

`GOLDEN_SEED_ORDER` writes the taxonomy parents before every link that
references them, and the referential check covers the nine new FK columns.
