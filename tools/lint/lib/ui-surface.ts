/** Render-capable path semantics shared by UI evidence guards. */
const RENDERED_APP_ROOT_RE =
  /^apps\/(?:academy-demo|admin|cms|docs|doctor|mobile|portal|promo|showcase)\//;
const RENDER_SOURCE_EXT_RE = /\.(?:[jt]sx|css)$/;
const USER_MESSAGE_RE =
  /^apps\/(?:academy-demo|admin|cms|docs|doctor|mobile|portal|promo|showcase)\/messages\/[^/]+\.json$/;
const DS_RENDER_SOURCE_RE =
  /^packages\/design-system\/src\/.*\.(?:[jt]sx?|css)$/;
/**
 * App-owned runtime TypeScript participates when its filename explicitly owns
 * visual theme, copy/message, or render/view-state semantics. This naming
 * contract stays extensible without treating arbitrary server/data modules as UI.
 */
const APP_RENDER_RUNTIME_TS_RE =
  /^apps\/(?:academy-demo|admin|cms|docs|doctor|mobile|portal|promo|showcase)\/.*\/(?:theme|[^/]+-(?:theme|copy|message|view-state|render-state))\.ts$/;
const DS_TOKEN_SOURCE_RE =
  /^packages\/design-system\/(?:tokens\/(?:primitive|semantic|semantic\.dark|component)\.json|src\/styles\/tokens\.css)$/;
const NON_RENDER_SOURCE_RE =
  /(\.test\.[tj]sx?$|\.spec\.[tj]sx?$|\/__tests__\/|(^|\/)e2e\/|\.config\.[mc]?[tj]s$|\.setup\.[mc]?[tj]sx?$)/;

export type UiEvidenceProfile = "native-mobile" | "responsive-web";

export function isUiSourcePath(path: string): boolean {
  if (NON_RENDER_SOURCE_RE.test(path)) return false;
  if (DS_TOKEN_SOURCE_RE.test(path)) return true;
  if (USER_MESSAGE_RE.test(path)) return true;
  if (DS_RENDER_SOURCE_RE.test(path)) return true;
  if (APP_RENDER_RUNTIME_TS_RE.test(path)) return true;
  return RENDERED_APP_ROOT_RE.test(path) && RENDER_SOURCE_EXT_RE.test(path);
}

export function evidenceProfilesForPaths(paths: string[]): UiEvidenceProfile[] {
  const profiles = new Set<UiEvidenceProfile>();
  for (const path of paths.filter(isUiSourcePath)) {
    profiles.add(
      path.startsWith("apps/mobile/") ? "native-mobile" : "responsive-web",
    );
  }
  return [...profiles].sort();
}
