# @ds/events-storefront

## 0.1.0

### Minor Changes

- [#2034](https://github.com/doctor-school/ds-platform/pull/2034) [`09bd1d8`](https://github.com/doctor-school/ds-platform/commit/09bd1d88842c7faf45db3fc5aae189fd05144c2c) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 005 EARS-1/2/3/4 on doctor.school — one-tap эфир registration, as ONE shared
  control on both storefronts.

  The Academy one-tap registration and its completion-on-return rule move out of
  `apps/portal/{app/webinars/[slug],lib}` into the new `@ds/events-storefront`
  package (tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §4 Stage 0):
  the `RegisterOneTap` control (`./ui`), the browser transport (`./client`), the
  session-bound registration read and the server action (`./server`), and the
  `completeReturnTarget` decision rule (`.`). Each host supplies only its own
  projection — which return shapes are its own, where nothing lands, its own copy
  and its own event path.

  The doctor storefront now reads the per-viewer registration state on
  `/events/<slug>` and renders that control for a signed-in doctor who is not yet
  registered, so the card flips to «Вы записаны» in place. Both of its auth doors
  complete a carried эфир intent once the session exists: `/login` after sign-in,
  and `/register` after the held-password replay that follows email confirmation
  (003 EARS-39). A guest still goes through `/register?returnTo=…` and arrives
  registered. Academy behaviour is unchanged — only the code moved.

### Patch Changes

- Updated dependencies [[`4e48d2a`](https://github.com/doctor-school/ds-platform/commit/4e48d2a98cb2c288db9c589bc6fc96da43f00401), [`bd198c3`](https://github.com/doctor-school/ds-platform/commit/bd198c33d326750623b73ecea4e9cd6239abab32), [`7aba7ae`](https://github.com/doctor-school/ds-platform/commit/7aba7aef5843d34245b07b7fd52b021ff297eaa8), [`68f69b3`](https://github.com/doctor-school/ds-platform/commit/68f69b3bae1407c506891d046919583becc0ac63), [`98d9509`](https://github.com/doctor-school/ds-platform/commit/98d9509a65216edfd8d6c99a9074b82d011e4cd9), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`c120660`](https://github.com/doctor-school/ds-platform/commit/c1206608e95b365e77ff47563926452287243f32), [`f93d81c`](https://github.com/doctor-school/ds-platform/commit/f93d81c444ebf021f0562c18e8b76b3dc4354bd2), [`e926d75`](https://github.com/doctor-school/ds-platform/commit/e926d75c9c71037687fc25de37e41539a3ba3d6d), [`06209df`](https://github.com/doctor-school/ds-platform/commit/06209df8a40e21749ebfac76cc118e65934e2c84), [`6484a11`](https://github.com/doctor-school/ds-platform/commit/6484a11ff00db3e4ced30227c64ed5b251bf5c4d), [`654f3ba`](https://github.com/doctor-school/ds-platform/commit/654f3baaf2dd8772de1820e2199baa982d539102), [`a846acd`](https://github.com/doctor-school/ds-platform/commit/a846acd36863bcd6b6ad0c6aad5ba477e6f6c839), [`8c54c06`](https://github.com/doctor-school/ds-platform/commit/8c54c06f7f4ce452eb2665d4680d1ce80fe87ad1), [`ec001b1`](https://github.com/doctor-school/ds-platform/commit/ec001b1c6cce81169ef056c3c09dffec5df3460b), [`04fa58f`](https://github.com/doctor-school/ds-platform/commit/04fa58f9dcbbc0131e30bdb3cd0bb52413c05d9d), [`d565d04`](https://github.com/doctor-school/ds-platform/commit/d565d049c4597b7ab2e30d34ec673f110abcfaf7), [`d32a070`](https://github.com/doctor-school/ds-platform/commit/d32a07089ea8b9c36f8cb085cc610d238042a70e), [`e6f4eba`](https://github.com/doctor-school/ds-platform/commit/e6f4eba29b04faac067a62ad4ce9b7fcdb09cb32), [`9ea994f`](https://github.com/doctor-school/ds-platform/commit/9ea994fb52a731be7a183181f8753367386de3bf), [`57ef112`](https://github.com/doctor-school/ds-platform/commit/57ef11212e6cab3c3dde3029775688ff9cc74ed4), [`d04e10a`](https://github.com/doctor-school/ds-platform/commit/d04e10a0c24dce99c573cc33862e8ef8bc64e823), [`0e0f1cf`](https://github.com/doctor-school/ds-platform/commit/0e0f1cf895748b9185ab44e5055044ba36a37a57), [`bf0c6d8`](https://github.com/doctor-school/ds-platform/commit/bf0c6d8b2afebfe00ebe879da0aada0a1c631c3f), [`8f5ea39`](https://github.com/doctor-school/ds-platform/commit/8f5ea39ead9446fef812425d5f4e3ae9bd723495), [`71f382c`](https://github.com/doctor-school/ds-platform/commit/71f382ce9b17e97ad947da94773143c378f9179e), [`29aca1e`](https://github.com/doctor-school/ds-platform/commit/29aca1efe2e468cd5ab02ea87176e5e64ea2c3c6), [`6ac683b`](https://github.com/doctor-school/ds-platform/commit/6ac683b8bf94663a55cb6dbab542aa851220bba5), [`0e0f1cf`](https://github.com/doctor-school/ds-platform/commit/0e0f1cf895748b9185ab44e5055044ba36a37a57), [`b6f0fcd`](https://github.com/doctor-school/ds-platform/commit/b6f0fcde0872ac1c9517498cfb101cac3c42fd09), [`5688b56`](https://github.com/doctor-school/ds-platform/commit/5688b564e2b4850a8a0fd81813dde210e99fd827), [`439e749`](https://github.com/doctor-school/ds-platform/commit/439e74902873f9c3bb0900e73ad393f7c192be1e), [`5a8e03f`](https://github.com/doctor-school/ds-platform/commit/5a8e03f0746ffcc3b8fb7260d906785f4b7b9a0e), [`cdd7b52`](https://github.com/doctor-school/ds-platform/commit/cdd7b52c9c64d27c976c08f4060b64f0c54830bd), [`dad13c3`](https://github.com/doctor-school/ds-platform/commit/dad13c3628625ef2ac5b67bcb4cc144b299ebb71), [`dfe3a50`](https://github.com/doctor-school/ds-platform/commit/dfe3a5098073a4d57d4656d21dd8e5b801748970), [`836cad8`](https://github.com/doctor-school/ds-platform/commit/836cad87fd5691ddfbcea3614cf1c3df4ca6b321), [`c734f7b`](https://github.com/doctor-school/ds-platform/commit/c734f7b8df04c6514550da38894ffd681f702f86), [`222667b`](https://github.com/doctor-school/ds-platform/commit/222667baccba9cfcf0b7671a582f68127db4c99c), [`68ba282`](https://github.com/doctor-school/ds-platform/commit/68ba2821bfede1afd2d10cef8e62974450e2c889)]:
  - @ds/design-system@5.4.0
  - @ds/schemas@6.0.0
