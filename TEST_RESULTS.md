# MoveNotice test results

The full test suite and production build passed on **25 November 2026 (UTC)** with network access denied. The results below are from that run. Earlier local verification also covered Foundry coverage and a production startup smoke check.

## Results

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Foundry · MoveNotice | 33 | 0 | 0 |
| Foundry · GuardedPay | 8 | 0 | 0 |
| Vitest · CLI | 24 | 0 | 0 |
| Vitest · web | 35 | 0 | 0 |

Foundry ran 256 inputs for `testFuzz_postWarpResolve`. Vitest ran 59 tests across five files, for 100 passing tests overall. The suites include the fixed Solidity and TypeScript message vectors, real ML-DSA-87 signing and rejection of a modified signature, and mocked web RPC calls. The tests use synthetic keys only. The latest web tests cover pending payment hashes across recipient checks and reloads, sender and chain scoping, blocking repeats until a receipt arrives, and disabling Guarded send when startup cannot verify the configured MoveNotice address.

`pnpm build` passed. It checked the existing Foundry artifacts, type-checked the CLI, shared code and web app, and built the Vite production bundle. Both audit drafts compiled separately with Solidity 0.8.28 during the initial verification. In an earlier run, the production bundle rendered its setup state and navigated to **How it works** in a local jsdom smoke check. `pnpm notice help` also ran with network access denied.

## Coverage

The earlier 22 November 2026 coverage run used standard Foundry instrumentation. These are the baseline figures from that run.

| Scope | Lines | Statements | Branches | Functions |
|---|---:|---:|---:|---:|
| MoveNotice | 100% (75/75) | 100% (104/104) | 100% (23/23) | 100% (12/12) |
| GuardedPay | 100% (12/12) | 100% (14/14) | 100% (3/3) | 100% (3/3) |
| Foundry total, including script and test helpers | 87.76% (129/147) | 86.67% (156/180) | 92.86% (26/28) | 93.33% (28/30) |

The deploy script was compiled and left unexecuted. Its coverage row is zero. The local protocol tests use precompile stand-ins. The testnet deployment and both QCAI stages are documented in the [repository README](README.md#audit).

## Tool versions and build notes

| Tool | Version |
|---|---|
| Forge | 1.10.0, commit `083e22994195d6a7e3ad3104d0b57f478c9b9062` |
| Solidity | 0.8.28, commit `7893614a` |
| Node | v24.12.0 |
| pnpm | 11.25.0 |
| Vitest | 3.2.7 |
| Vite | 6.4.6 |

Forge lint emitted advisories on intentional recipient forwarding, timestamp comparisons, bounded timestamp casts and unused tuple fields. Vite reported an upstream `@scure/base` annotation warning and a main chunk above 500 kB. The main JavaScript chunk is 685.56 kB gzip.

## Integration differences

- Both templates ran successfully with `create-qorechain-dapp@0.14.0`.
- The installed `@qorechain/qorex-rainbowkit@0.1.0` declares `getQorexEip1193Provider` in `dist/index.d.ts:31`. The app uses it with EIP-6963 announcements in `web/src/lib/wallet.ts).
- The workshop's `window:scoped` convenience script uses an unscoped builder call. MoveNotice passes both allowed targets when opening the scoped window. [Workshop package.json, line 15](https://github.com/qorechain/build-before-qday/blob/main/workshop-2/01-qday-vault/package.json#L15) · [Workshop window.ts, line 160](https://github.com/qorechain/build-before-qday/blob/main/workshop-2/01-qday-vault/scripts/window.ts#L160)
- The workshop builds registration manually at `scripts/window.ts:136`. The installed SDK exposes the requested idempotent `ensurePqcRegistered(tx, opts)` at `dist/index.d.ts:16252`. The CLI connects a `TxClient` to the eth-native signer for coin-60 bootstrap. [Workshop registration](https://github.com/qorechain/build-before-qday/blob/main/workshop-2/01-qday-vault/scripts/window.ts#L136)
- The brief called the cover optional. The current Rules page lists a featured image among project requirements. The project includes a 1600×900 PNG under 5 MB. [Fest rules](https://build.qorechain.io/rules)
