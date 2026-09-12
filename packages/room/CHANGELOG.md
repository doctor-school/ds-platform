# @ds/room

## 1.0.0

### Major Changes

- [#2057](https://github.com/doctor-school/ds-platform/pull/2057) [`5dc1a61`](https://github.com/doctor-school/ds-platform/commit/5dc1a617adcb66eb5716d498b4223a133e6947db) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Forward the client's `x-forwarded-for` on every SSR authed read ([#2054](https://github.com/doctor-school/ds-platform/issues/2054)).

  Since [#1655](https://github.com/doctor-school/ds-platform/issues/1655) the api runs behind `FastifyAdapter({ trustProxy })`, so `request.ip`
  is the real browser taken from the forwarded chain and the BFF session
  fingerprint (ADR-0001 §6) is bound to the BROWSER's IP/24. Every server-side read
  from the Next containers built its own header set and dropped the chain, so the
  api saw the container address (172.18.0.x), re-derived a different fingerprint and
  401'd valid sessions — signed-in doctors were bounced off «Мои события» and the
  event/room pages.

  `ForwardedSession` gains a required `forwardedFor`, and one canonical
  `forwardedSessionFrom` / `forwardedHeaders` pair in `@ds/events-storefront/server`
  now builds every hop's headers (`@ds/room` mirrors it as `roomForwardedHeaders`
  for its own structural `RoomSession`, which likewise gains the field). Both are
  required-field additions to an exported interface, i.e. breaking for consumers.

## 0.1.0

### Minor Changes

- [#1929](https://github.com/doctor-school/ds-platform/pull/1929) [`034671c`](https://github.com/doctor-school/ds-platform/commit/034671c37e60bfd8193e9b8fb1288ed2b7afdf2d) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 006 EARS-18: a structurally silent player provider (cdnvideo) now mounts in the `unverified` state and the room renders nothing of its own over it — no watchdog advisory banner, no covering overlay and no restart control, just the bare provider iframe whose own in-iframe controls are the only affordance.

- [#1938](https://github.com/doctor-school/ds-platform/pull/1938) [`21eaccf`](https://github.com/doctor-school/ds-platform/commit/21eaccf91069eb31d1c5904dda3b76441d3408d9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 006 EARS-7 — an already-open room degrades to an ended state instead of keeping
  a dead live stream on screen. `RoomApiError` now carries the lifecycle `state`
  parsed from a refusal body; the presence heartbeat promotes a `409` refusal
  whose state is present and not `live` to a one-way `onRoomClosed` latch and
  stops beating. The room shell lifts that phase, so the player slot is replaced
  by the «Эфир завершён» end card (no iframe, no live badge, no restart button),
  the header pill goes neutral without a duration, and the chat composer is
  replaced by a truthful status strip while the message ledger stays readable.
  Both hosts map the four new RU copy keys.

- [#1868](https://github.com/doctor-school/ds-platform/pull/1868) [`f9d3e5b`](https://github.com/doctor-school/ds-platform/commit/f9d3e5b6eec35814298f2a843b209b60f4fb4177) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Extract the webinar room's pure model and browser transport into the shared `@ds/room` package. The portal keeps its room components and re-export shims, so there is no behaviour or render change; only import paths move.

### Patch Changes

- [#1870](https://github.com/doctor-school/ds-platform/pull/1870) [`f3ad99f`](https://github.com/doctor-school/ds-platform/commit/f3ad99fdf399cf7cfec87292ca2d0ed22fb34cfc) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Room composition moved into `@ds/room/ui`: the six room components, the presence channel and the two server reads now live in the shared package, parameterised on a host-injection contract (copy, room API, link component + routes, user-cluster slot). The academy route at `/webinars/[slug]/room` is re-seated as a thin server host projection over `RoomShell` with no render delta.

- [#1904](https://github.com/doctor-school/ds-platform/pull/1904) [`df90729`](https://github.com/doctor-school/ds-platform/commit/df9072929a7084b3b259d727f7081e45c68cdb30) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 006 EARS-18 — «Перезапустить плеер» no longer stands over a stream that is
  playing. A VK live embed talks to its parent only when the embed src carries
  `js_api=1`; the room built the src without it, so it observed nothing, the
  watchdog fired on a perfectly healthy broadcast and the doctor saw «Похоже,
  трансляция не загружается» plus a restart control on top of playing video.
  Every vk src is now built with `js_api=1`, and vk is a parent-observable
  provider: its `inited` handshake, `started` and recurring `timeupdate`
  (`state: "playing"` / `"unstarted"`) signals are parsed under a strict
  `https://vk.com` origin guard and clear the watchdog. VK carries no error
  event, so none is ever synthesized — a vk stall is still graded by the
  watchdog alone.

  CDNvideo stays permanently unobservable (its bundles emit no parent message at
  all), so the room adds an `unverified` player state for it in which it shows
  nothing of its own: no advisory, no overlay and no restart control over the
  embed — a permanently visible control the room cannot justify is the same
  intrusion as a permanent banner. A failed youtube/rutube/vk handshake keeps its
  advisory banner, because for those a real signal can still arrive.

- Updated dependencies [[`4e48d2a`](https://github.com/doctor-school/ds-platform/commit/4e48d2a98cb2c288db9c589bc6fc96da43f00401), [`bd198c3`](https://github.com/doctor-school/ds-platform/commit/bd198c33d326750623b73ecea4e9cd6239abab32), [`7aba7ae`](https://github.com/doctor-school/ds-platform/commit/7aba7aef5843d34245b07b7fd52b021ff297eaa8), [`68f69b3`](https://github.com/doctor-school/ds-platform/commit/68f69b3bae1407c506891d046919583becc0ac63), [`98d9509`](https://github.com/doctor-school/ds-platform/commit/98d9509a65216edfd8d6c99a9074b82d011e4cd9), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`c120660`](https://github.com/doctor-school/ds-platform/commit/c1206608e95b365e77ff47563926452287243f32), [`f93d81c`](https://github.com/doctor-school/ds-platform/commit/f93d81c444ebf021f0562c18e8b76b3dc4354bd2), [`e926d75`](https://github.com/doctor-school/ds-platform/commit/e926d75c9c71037687fc25de37e41539a3ba3d6d), [`06209df`](https://github.com/doctor-school/ds-platform/commit/06209df8a40e21749ebfac76cc118e65934e2c84), [`6484a11`](https://github.com/doctor-school/ds-platform/commit/6484a11ff00db3e4ced30227c64ed5b251bf5c4d), [`654f3ba`](https://github.com/doctor-school/ds-platform/commit/654f3baaf2dd8772de1820e2199baa982d539102), [`a846acd`](https://github.com/doctor-school/ds-platform/commit/a846acd36863bcd6b6ad0c6aad5ba477e6f6c839), [`8c54c06`](https://github.com/doctor-school/ds-platform/commit/8c54c06f7f4ce452eb2665d4680d1ce80fe87ad1), [`ec001b1`](https://github.com/doctor-school/ds-platform/commit/ec001b1c6cce81169ef056c3c09dffec5df3460b), [`04fa58f`](https://github.com/doctor-school/ds-platform/commit/04fa58f9dcbbc0131e30bdb3cd0bb52413c05d9d), [`d565d04`](https://github.com/doctor-school/ds-platform/commit/d565d049c4597b7ab2e30d34ec673f110abcfaf7), [`d32a070`](https://github.com/doctor-school/ds-platform/commit/d32a07089ea8b9c36f8cb085cc610d238042a70e), [`e6f4eba`](https://github.com/doctor-school/ds-platform/commit/e6f4eba29b04faac067a62ad4ce9b7fcdb09cb32), [`9ea994f`](https://github.com/doctor-school/ds-platform/commit/9ea994fb52a731be7a183181f8753367386de3bf), [`57ef112`](https://github.com/doctor-school/ds-platform/commit/57ef11212e6cab3c3dde3029775688ff9cc74ed4), [`d04e10a`](https://github.com/doctor-school/ds-platform/commit/d04e10a0c24dce99c573cc33862e8ef8bc64e823), [`0e0f1cf`](https://github.com/doctor-school/ds-platform/commit/0e0f1cf895748b9185ab44e5055044ba36a37a57), [`bf0c6d8`](https://github.com/doctor-school/ds-platform/commit/bf0c6d8b2afebfe00ebe879da0aada0a1c631c3f), [`8f5ea39`](https://github.com/doctor-school/ds-platform/commit/8f5ea39ead9446fef812425d5f4e3ae9bd723495), [`71f382c`](https://github.com/doctor-school/ds-platform/commit/71f382ce9b17e97ad947da94773143c378f9179e), [`29aca1e`](https://github.com/doctor-school/ds-platform/commit/29aca1efe2e468cd5ab02ea87176e5e64ea2c3c6), [`6ac683b`](https://github.com/doctor-school/ds-platform/commit/6ac683b8bf94663a55cb6dbab542aa851220bba5), [`0e0f1cf`](https://github.com/doctor-school/ds-platform/commit/0e0f1cf895748b9185ab44e5055044ba36a37a57), [`b6f0fcd`](https://github.com/doctor-school/ds-platform/commit/b6f0fcde0872ac1c9517498cfb101cac3c42fd09), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`439e749`](https://github.com/doctor-school/ds-platform/commit/439e74902873f9c3bb0900e73ad393f7c192be1e), [`5a8e03f`](https://github.com/doctor-school/ds-platform/commit/5a8e03f0746ffcc3b8fb7260d906785f4b7b9a0e), [`cdd7b52`](https://github.com/doctor-school/ds-platform/commit/cdd7b52c9c64d27c976c08f4060b64f0c54830bd), [`dad13c3`](https://github.com/doctor-school/ds-platform/commit/dad13c3628625ef2ac5b67bcb4cc144b299ebb71), [`dfe3a50`](https://github.com/doctor-school/ds-platform/commit/dfe3a5098073a4d57d4656d21dd8e5b801748970), [`836cad8`](https://github.com/doctor-school/ds-platform/commit/836cad87fd5691ddfbcea3614cf1c3df4ca6b321), [`c734f7b`](https://github.com/doctor-school/ds-platform/commit/c734f7b8df04c6514550da38894ffd681f702f86), [`222667b`](https://github.com/doctor-school/ds-platform/commit/222667baccba9cfcf0b7671a582f68127db4c99c), [`68ba282`](https://github.com/doctor-school/ds-platform/commit/68ba2821bfede1afd2d10cef8e62974450e2c889)]:
  - @ds/design-system@5.4.0
  - @ds/schemas@6.0.0
