---
"@ds/api": patch
---

#3572: both media sweeps (the cleanup worker and the upload reconciler) now keep an object any registered media slot still references, including `organisations.logo_ref`; the reference predicate iterates one `MediaSlotRegistry` that modules outside taxonomy extend from their own `onModuleInit`.
