# Password reveal caret evidence â€” #2905 / PR #2914

These are immutable browser captures, copied byte-for-byte after the root's visual and privacy QA. `publication-provenance.json` maps each source to its committed path and verifies every SHA-256 identity.

The baseline is source/runtime `59ba49768494c1dd54cd8f3a86ca38e745dfb1e5`; the final captures are source/runtime A `213baf7c68cc8f2018da92c4746bb8287e8e486e`. The published code was rebased onto actual main `b473f509f36242136d92aa92018fc96e3bf486a4`. `a-to-aprime-equivalence.json.txt` records exact shipping-auth/API/host-config/canvas/dependency tree and blob identity; the evidence commit adds only this directory and the e2e README correction. The root separately runs the strict BDD from the final published source against the pinned compiled A. Captures alone do not claim final-head browser, review, CI, merge or deployment acceptance.

All six Academy/Doctor registration, password-login and reset-complete screens have desktop/mobile light/dark fullpages, actual press, caret reveal/remask, keyboard-focus and invalid states in `baseline/` and `final/`. `comparison/` contains 24 before/after caret pairs; `paste-proof.json.txt` verifies their captured pixels are unchanged and captions are outside the app pixels. Contact sheets preserve original resolution.

`PR-BODY-CANVAS-COMPARISON.actual.md.txt` and `full-canvas-inventory.actual.json.txt` retain every touched screen element and explicit inactive conditional states. They retain inherited canvas differences: label-to-input gap 10px versus 7px, underline offset auto versus 4px, and pressed opacity 1 versus .8. No styling or canvas correction is included.

The immutable original 16 immediate-blur border differences remain. The separate eight-row desktop registration/reset diagnostic naturally awaited the existing .15s transition and observed the declared destructive tokens. It did not separately drive old-baseline, mobile or login settled endpoints. Later `root-final-eyes-qa.md.txt` and `invalid-border-resolution.json.txt` supersede earlier snapshot wording about missing lead eyes-on or a not-yet-observed stable endpoint; they do not rewrite the original measurements. No universal all-state pixel equality is claimed.

No trace, secret-bearing account artifact, raw mail, browser script or runtime process file is published. The shown password is an explicit public never-submitted demonstration value. Production was not changed.

Immutable source metadata uses .txt suffixes to preserve approved bytes through normal formatting hooks. The manifest retains both original source names and committed destination names.
