# @ds/legal-content

## 0.1.0

### Minor Changes

- [#1988](https://github.com/doctor-school/ds-platform/pull/1988) [`bc18826`](https://github.com/doctor-school/ds-platform/commit/bc188260cc26a6781c4fe1ff9f3bb4f7ae73a727) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Publish the two legacy legal documents carried over from the Bubble site: the personal-data policy and the photo/video distribution consent.

### Patch Changes

- [#1993](https://github.com/doctor-school/ds-platform/pull/1993) [`a846acd`](https://github.com/doctor-school/ds-platform/commit/a846acd36863bcd6b6ad0c6aad5ba477e6f6c839) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Resolve the default documents directory with `join(dirname(fileURLToPath(import.meta.url)), "..", "documents")` instead of `new URL("../documents/", import.meta.url)`. Bundlers treat the literal `new URL(..., import.meta.url)` form as a static asset reference and fail the consuming build with `Module not found: Can't resolve '../documents/'`, which made the package unusable from the Next.js server components it is written for. Runtime behaviour is unchanged.
