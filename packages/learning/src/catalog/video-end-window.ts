/**
 * EARS-10 — the end window: a provider clock ticks about once a second and
 * the last tick before the player stops can fall short of the media length,
 * so a position this close to the end counts as the end. It absorbs clock
 * granularity only, never skipped content.
 *
 * A leaf module with no imports: the step screen (a client component) reads it
 * without pulling the server catalog and its NodeNext `.js` imports into the
 * browser bundle.
 */
export const VIDEO_END_WINDOW_SEC = 2;
