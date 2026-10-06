---
"@ds/design-system": patch
---

`NativeSelect` no longer clips the descenders of its selected value: its
vertical padding now leaves a content box one `text-sm` line tall (44px control,
2px border, `py-2.5`), since a native select clips its value to the content box
instead of centring the line the way `Input` does (#2509).
