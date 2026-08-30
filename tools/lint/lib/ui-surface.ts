/** Shared path semantics for PR guards that classify rendered UI source. */
export const UI_SOURCE_ROOT_RE =
  /^(apps\/(?:portal|promo|admin|academy-demo)\/|packages\/design-system\/)/;

export const UI_SOURCE_EXEMPT_RE =
  /(\.md$|\.mdx$|\.json$|\.css$|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|\/__tests__\/|(^|\/)e2e\/|\.config\.[mc]?[tj]s$|\.setup\.[mc]?[tj]sx?$|\/styles\/tokens\.css$|allowed-tokens\.json$|(^|\/)Dockerfile[^/]*$|(^|\/)\.[^/]+$|\.env\.example$|\.ya?ml$)/;

export function isUiSourcePath(path: string): boolean {
  return UI_SOURCE_ROOT_RE.test(path) && !UI_SOURCE_EXEMPT_RE.test(path);
}
