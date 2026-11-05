---
"@ds/db": patch
"@ds/e2e": patch
---

#3705: the golden seed carries one published Academy news item (`golden.materials.published`, slug `golden-material-published`) and its feed card, so the stage route walk resolves the 048 reading page `/materials/[slug]` instead of failing on a missing route-params entry. A re-run keeps the material's first publication instant and the card date together.
