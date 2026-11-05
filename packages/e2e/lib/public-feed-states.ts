export const publicFeedStateTitles = [
  "A content type that is not connected has no block at all",
  "An event whose option hides the sign-up counter shows none",
  "An offline meet-up is a format of the event card",
] as const;

// Playwright prefixes the title with project/feature names and appends inherited tags.
export const publicFeedStatePattern = new RegExp(
  `(?:^|\\s)(?:${publicFeedStateTitles.join("|")})(?: @[^ ]+)*$`,
);
