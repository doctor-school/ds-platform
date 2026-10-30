---
title: "Visual delivery"
---

# Visual delivery (report-task-outcome reference)

A visual the owner cannot see is worthless: an image-view tool may render only to the agent. Which visual the owner gets is set by the change tier (`.claude/rules/change-tiers.md` → Stage-B and stands): an Ask change with a visible difference gets a stand link the lead raised itself, with working login; a Show change gets the screenshots of the lead's own run of the app; a Ship change cites the owner's original request. Screenshots record what the lead drove; they never replace driving the app.

1. **Build** — render the real surface, or a focused HTML mock of the change (real tokens + Inter), on a local server. When the browser capability blocks `file://`, use `python -m http.server <port> --bind 127.0.0.1`.
2. **Capture** via Playwright (`browser_take_screenshot`, full page). Resolve the browser tool's output location (with the Claude MCP guard: `<repo>/.playwright-mcp/`), move the files out of git and confirm the source files are gone (`git status` cannot see that ignored directory).
3. **Deliver** — copy to a local folder the owner can open, outside git (the machine path lives in auto-memory), and open it (`Start-Process -FilePath <path>`). Never ask for approval while the image is visible only inside the agent's CLI.
4. For a visible change, make it a **before/after** pair, not only the final state.
5. Stop the local preview server you started (by its PID) when done.
