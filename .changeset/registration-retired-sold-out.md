---
"@ds/api": patch
---

Registration no longer accepts a retired event (the not-found answer, as the public event page), and a pure offline event with no seats left refuses the registration with a `sold-out` conflict instead of recording it; a hybrid event with its offline seats exhausted still registers the doctor online. A registrar can no longer mark attendance on, or desk-register into, a retired event.
