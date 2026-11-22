# Two-stage QCAI audit

The builder runs both audit stages and saves dated reports. The first audit each UTC day is free under the current dashboard rules. The reports are a first check. Arrange a separate human review before relying on these contracts for live funds. [Contract Auditor documentation](https://docs.qorechain.io/dashboard/contract-auditor/)

## Stage 1 · First working drafts

1. Sign in and open **AI Audit** at the [QoreChain dashboard](https://dashboard.qorechain.io/audit).
2. Select an EVM/Solidity setting, such as **Ethereum (EVM/Solidity)**. The QoreChain setting covers CosmWasm.
3. Audit [MoveNotice’s first draft](MoveNotice_v0_draft.sol) and [GuardedPay’s first draft](GuardedPay_v0_draft.sol). For a single-source input, include the imported Solidity declarations once and remove the matching import lines. Use the same composition method at Stage 2. Keep the draft source for review and use the final source for deployment.
4. Save the dated reports in this directory. Record the settings, contract revision and findings in the table below.

Stage 1 date, settings and report links **pending**.

## Findings, fixes and regression tests

The entries below document local hardening before any QCAI result. Append every Stage 1 finding, its resolution and its regression test.

| Source | Finding | Fix | Foundry test |
|---|---|---|---|
| Local review | An unexpected registered public-key length reached the verifier | Require the 2,592-byte ML-DSA-87 key length | `test_wrongKeyLength_reverts` |
| Local review | A cycle used all eight hops and could appear to resolve back to a visited account | Stop before visiting an account twice | `test_resolveFinal_followsChain_and_stopsOnCycle` |
| Local review | GuardedPay could be constructed against an address without code | Check for code on the immutable notice-board address | `test_constructor_rejectsMissingBoard` |
| Local review | A nested transfer could place its log before the outer payment log | Emit the entry event before the recipient callback and roll it back when forwarding fails | `test_nestedPaymentsEmitInEntryOrder`, `test_pay_revertingRecipientRollsBack` |
| Stage 1 | | | |
| Stage 1 | | | |

## Stage 2 · Final contracts

1. Audit [MoveNotice](../contracts/src/MoveNotice.sol) and [GuardedPay](../contracts/src/GuardedPay.sol) with the same EVM/Solidity setting.
2. Save dated reports with the final source revision. Record remaining findings and their disposition. Re-run local tests and rebuild after fixes. Redeploy and update the demo evidence if an audited source change affects the deployed bytecode.
3. Link both stages from the fest submission or from this file in the public repository.

Stage 2 date, settings and report links **pending**.

The EVM precompiles supply the ML-DSA-87 verification and registry read. The dashboard can show the Solidity quantum readiness score as unscored. Use the [README threat model](../README.md#post-quantum-protection) and tests to explain how the application uses both precompiles. [Workshop audit example](https://github.com/qorechain/build-before-qday/tree/main/workshop-2/01-qday-vault/audit)
