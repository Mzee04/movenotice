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

Audit summary
QCAI used Ethereum (EVM/Solidity). Both Stage 1 reports scored 85/100 with MEDIUM risk. The MoveNotice draft had four findings and the GuardedPay draft had five. Both Stage 2 reports scored 85/100 with MEDIUM risk and four findings each. The responses cover permissionless relay with required signatures, checked arithmetic, nonce replay protection, bounded traversal, native-currency payments, and atomic finalization. The full suite passed 91 tests.

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
