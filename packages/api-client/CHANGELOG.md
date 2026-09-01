# @ds/api-client

## 1.0.0

### Major Changes

- [#1686](https://github.com/doctor-school/ds-platform/pull/1686) [`f8cb3f9`](https://github.com/doctor-school/ds-platform/commit/f8cb3f93c6c2512433a5840afcbdbbb0ef28a712) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Complete the ADR-0016 §5 `topics` → `directions` rename through the 012 EARS-11
  event join ([#1645](https://github.com/doctor-school/ds-platform/issues/1645)). The table is now `event_directions` with a `direction_id`
  column (true rename — every retained row, id, version and audit lineage
  survives), the admin surface is `/v1/admin/event-directions`, and the public
  traversal answers `GET /v1/public/events/:idOrSlug/directions` and
  `GET /v1/public/directions/:idOrSlug/events`.

  Breaking: the old `event-topics` / `…/topics` routes and the `EventTopic*` /
  `PublicTopicSummary*` contract exports are gone with no alias — the rename has
  no consumers outside this repo. Behaviour, pagination, problem shapes and
  visible RU copy are unchanged.

## 0.1.0

### Minor Changes

- [#1636](https://github.com/doctor-school/ds-platform/pull/1636) [`3a13d7c`](https://github.com/doctor-school/ds-platform/commit/3a13d7cca9ec57062a8c102ef811471a7eb86651) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - [#1610](https://github.com/doctor-school/ds-platform/issues/1610): author all five taxonomy relationships from either endpoint with one retained command, bounded server search, and the canonical in-dropdown Combobox.
