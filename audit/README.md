# Two-stage QCAI audit

The builder runs both audit stages and saves dated reports. The dashboard requires a balance of 150 QOR to run an audit and leaves that balance intact. The reports are a first check. Arrange a separate human review before relying on these contracts for live funds. [Contract Auditor documentation](https://docs.qorechain.io/dashboard/contract-auditor/)

## Stage 1 · First working drafts

1. Sign in and open **AI Audit** at the [QoreChain dashboard](https://dashboard.qorechain.io/audit).
2. Select an EVM/Solidity setting, such as **Ethereum (EVM/Solidity)**. The QoreChain setting covers CosmWasm.
3. Audit [MoveNotice’s first draft](MoveNotice_v0_draft.sol) and [GuardedPay’s first draft](GuardedPay_v0_draft.sol). For a single-source input, include the imported Solidity declarations once and remove the matching import lines. Use the same composition method at Stage 2. Keep the draft source for review and use the final source for deployment.
4. Save the dated reports in this directory. Record the settings, contract revision and findings in the table below.

Stage 1 ran on **23 Nov 2026** for [audit/MoveNotice_v0_draft.sol](MoveNotice_v0_draft.sol) using **Ethereum (EVM/Solidity)**. The report recorded a score of **85/100**, **MEDIUM** risk, and unscored quantum readiness. [audit/stage1_MoveNotice_v0_draft.pdf](stage1_MoveNotice_v0_draft.pdf)

Stage 1 ran on **24 Nov 2026** for [audit/GuardedPay_v0_draft.sol](GuardedPay_v0_draft.sol) using **Ethereum (EVM/Solidity)**. The report recorded a score of **85/100** and **MEDIUM** risk. [audit/stage1_GuardedPay_v0_draft.pdf](stage1_GuardedPay_v0_draft.pdf)

The other GuardedPay findings repeat issues already recorded in the Stage 1 table.

## Findings, fixes and regression tests

The local review entries document hardening before the QCAI run. Record each Stage 1 finding, its resolution and its regression test here.

| Source | Finding | Fix | Foundry test |
|---|---|---|---|
| Local review | An unexpected registered public-key length reached the verifier | Require the 2,592-byte ML-DSA-87 key length | `test_wrongKeyLength_reverts` |
| Local review | A cycle used all eight hops and could appear to resolve back to a visited account | Stop before visiting an account twice | `test_resolveFinal_followsChain_and_stopsOnCycle` |
| Local review | GuardedPay could be constructed against an address without code | Check for code on the immutable notice-board address | `test_constructor_rejectsMissingBoard` |
| Local review | A nested transfer could place its log before the outer payment log | Emit the entry event before the recipient callback and roll it back when forwarding fails | `test_nestedPaymentsEmitInEntryOrder`, `test_pay_revertingRecipientRollsBack` |
| Stage 1 | **HIGH** · Missing access control on `postMove` and `cancelMove` (reported lines 67 and 90) | By design. Anyone may relay, and each call requires the account’s ML-DSA-87 signature over a message bound to the chain ID, contract address, nonce, and `validUntil`. | `test_postMove_badSignature_reverts`, `test_classicalKeyOnlyAttacker_cannotPost`, `test_classicalKeyOnlyAttacker_cannotCancel` |
| Stage 1 | **MEDIUM** · Overflow in `effectiveAt` (reported line 77) | Addressed in the final source. Delay is bounded from `minDelay` to `MAX_DELAY` (30 days), and Solidity 0.8 checked addition reverts on overflow. Both safeguards were already present in the draft. | `test_delayBelowMinimum_reverts`, `test_delayAboveMax_reverts` |
| Stage 1 | **LOW** · Unbounded loop in `resolveFinal` (reported line 111) | The final source caps traversal at eight hops and stops on cycles. | `test_resolveFinal_followsChain_and_stopsOnCycle`, `test_resolveFinal_capsHopsAtEight` |
| Stage 1 | **INFO** · Front-running `postMove` (reported line 67) | No impact on the signed move. A front-runner can only relay the same signed move, preserving the target and delay. The nonce prevents replay. | `test_anyoneCanRelayAValidSignature`, `test_replay_samePostSignature_reverts` |
| Stage 1 · GuardedPay | **MEDIUM** · Race condition in move finalization (reported `MoveNotice.sol:126`) | Finalization stores the target and clears the pending move atomically, without an external call. Cancellation also clears the pending move. A later finalize reverts with `NoPendingMove` in either case. Each nested GuardedPay call resolves its own recipient, so a callback cannot send to a moved account. | `test_finalizeTwice_revertsAndPreservesFinalTarget`, `test_finalizeAfterCancel_revertsAndLeavesAccountUnmoved`, `test_pay_reentrantFinalizeCannotBypassMovedCheck`, `test_nestedPaymentsEmitInEntryOrder` |
| Stage 1 · GuardedPay | **INFO** · No ERC compliance indicators | By design. GuardedPay guards and forwards native-currency payments. | `test_pay_toUnmoved_forwards` |

## Stage 2 · Final contracts

1. Audit [MoveNotice](paste/MoveNotice_final.flat.sol) and [GuardedPay](paste/GuardedPay_final.flat.sol) using the same EVM/Solidity setting. These standalone inputs include each imported declaration once.
2. Save dated reports with the final source revision. Record remaining findings and their disposition. Re-run local tests and rebuild after fixes. Redeploy and update the demo evidence if an audited source change affects the deployed bytecode.
3. Link both stages from the fest submission or from this file in the public repository.

Stage 2 date, settings and report links **pending**.

The EVM precompiles supply the ML-DSA-87 verification and registry read. The dashboard can show the Solidity quantum readiness score as unscored. Use the [README threat model](../README.md#post-quantum-protection) and tests to explain how the application uses both precompiles. [Workshop audit example](https://github.com/qorechain/build-before-qday/tree/main/workshop-2/01-qday-vault/audit)
