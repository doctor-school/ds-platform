---
"@ds/doctor": patch
"@ds/portal": patch
---

Both storefronts (Витрина and Академия) get a browser-tab icon: the brand mark
cut out of the logo (#2018). `app/icon.svg` carries the logo's three mark paths
byte for byte in a square viewBox, and `app/favicon.ico` is the same mark
rasterised at 16/32/48 px for clients that request `/favicon.ico` directly, so
that request now answers 200 instead of 404.
