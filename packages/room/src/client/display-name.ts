/**
 * D20 — the `@ds/room/display-name` subpath.
 *
 * The display-name helpers are needed by NON-room surfaces too (the Academy's
 * account page and its header avatar), and they must reach them without dragging
 * the room in: importing them from the client barrel `.` would pull the chat
 * transport — and with it `centrifuge` — into a plain account route's module graph.
 * This subpath carries the three helpers and no room UI.
 */
export { setDisplayName, DisplayNameError } from "./display-name-client";
export { initialsFromDisplayName } from "../model/display-name";
