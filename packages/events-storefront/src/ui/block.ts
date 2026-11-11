/**
 * The feed-block failure mechanism — one failed block's cause, «Повторить»
 * and its in-place retry (019 EARS-9, #2832) — for a sibling block of a page
 * that mounts the events blocks: 018's adjacent-areas block (EARS-8) fails
 * and recovers exactly as the nearest-events block beside it does, so it
 * mounts these rather than a second copy of the state machine.
 */
export { BlockError } from "./block-error";
export { BlockRetry } from "./block-retry";
