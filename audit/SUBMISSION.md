Project name
MoveNotice

Track
Post-Quantum dApp

Tagline
Post-quantum wallet move notices that let wallets refuse stale-address payments.

Short description
MoveNotice lets an account publish an ML-DSA-87-signed wallet move and cancel it before a delay ends. Once the move is final, GuardedPay refuses payments to the old address. Both contracts are deployed on QoreChain Testnet.

Full description
A message announcing a new wallet address can be forged. A genuine address change can also leave people sending money to the old account.

MoveNotice gives account owners a public way to announce that account A is moving to account B. The owner signs a notice with ML-DSA-87. Anyone can relay it, and the owner can cancel it with a new signed action before the delay ends. After the move becomes final, GuardedPay refuses payments to A and returns B for the sender to verify.

QoreChain Testnet runs the contracts on EVM chain 9800. MoveNotice uses QoreChain precompiles to check a proven registered key and verify each signature. A stolen classical key alone cannot authorize a move for an account with an established post-quantum key. The signed action binds the chain, contract, nonce and expiry. The demo scopes its EVM authorization window to the two deployed contracts.

Tech stack
Solidity 0.8.28, Foundry, TypeScript, viem, React, Vite, Vitest, QoreChain SDK and EVM tooling, QoreX wallet discovery.

Contract addresses
Network — QoreChain Testnet, EVM chain 9800
MoveNotice — 0x4275d4514c3b268A985975a97A9855556A8f90D8
GuardedPay — 0x78e20EC4A434C2a306928885c9a4f20f99C28f49

Explorer links (select Testnet in the explorer header first; it opens on Mainnet by default)
MoveNotice deploy — https://explore.qore.network/tx/16FBE409A77A816F2C70D9AA0364093AFE8B5063A213D60917FE00070ADA294A
GuardedPay deploy — https://explore.qore.network/tx/181C66BB8E3DA1F973E5FB124BF59FC167824A5CAF7C3107F8BC61A8F38CB727
Move posted (A1) — https://explore.qore.network/tx/CD668AD81880DBEE2A8BB5A624B5F4A0C05B1533EFF17AB07463FBD662284329
Move cancelled (A1) — https://explore.qore.network/tx/95B7B5E576FDBCF3AFE52BB0CA07F587D24998307016D0F6C8353D8007D04554
Move posted (A2) — https://explore.qore.network/tx/54823C4F9D17FDFFDDC853F66FFEA424A8799DF06FE5B3C223C43B190235DDDC
MoveNotice contract account — https://explore.qore.network/address/0x4275d4514c3b268A985975a97A9855556A8f90D8

Audit summary
QCAI used Ethereum (EVM/Solidity). Both Stage 1 reports scored 85/100 with MEDIUM risk. The MoveNotice draft had four findings and the GuardedPay draft had five. Both Stage 2 reports scored 85/100 with MEDIUM risk and four findings each. The responses cover permissionless relay with required signatures, checked arithmetic, nonce replay protection, bounded traversal, native-currency payments, and atomic finalization. The full suite passed 100 tests: 41 in Foundry and 59 in Vitest.

What's next
Record the demo and add the repository and video URLs. The next product milestone is wallet integration for checking notices before a payment is approved.

GitHub URL
[Paste GitHub repository URL here]

Demo video URL
[Paste demo video URL here]

Audit report links
[Stage 1 MoveNotice PDF](stage1_MoveNotice_v0_draft.pdf)
[Stage 1 GuardedPay PDF](stage1_GuardedPay_v0_draft.pdf)
[Stage 2 MoveNotice PDF](stage2_MoveNotice.pdf)
[Stage 2 GuardedPay PDF](stage2_GuardedPay.pdf)
