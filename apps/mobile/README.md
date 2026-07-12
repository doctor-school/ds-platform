# `@ds/mobile`

The DS Platform **mobile app** — **React Native + Expo + WatermelonDB**
(ADR-0005), the offline-capable doctor client for the Doctor.School audience.

## Status — reserved scaffold

This is a **reserved workspace slot**: the package currently holds only its
`package.json` (name `@ds/mobile`, `private`). The Expo app shell, navigation,
and the WatermelonDB offline sync land in a later vertical. Until then it declares
no build/dev scripts and ships nothing. Mobile is **not** part of the deployed
003 auth scope.

## Public surface

_None yet_ — the Expo entry point + screens arrive with the mobile vertical.

## Build / test

No package-local scripts yet. Once scaffolded it will follow the Expo toolchain
(`expo start` / EAS build) surfaced through workspace scripts; today it is a no-op
in `turbo run` fan-outs.

## Owning ADR

- **ADR-0005** — mobile stack (React Native + Expo + WatermelonDB).
