# AI usage

MoveNotice is a solo Build Before Q-Day entry in the Post-Quantum dApp track.

## Workflow

The project brief records AI-assisted ideation and a duplicate check against the fest gallery. The builder supplied the product design, chain references, threat model, test checklist and publishing boundaries. Codex implemented the local repository from that brief and checked relevant package exports and workshop code during the build.

**Builder to complete.** Add the date and scope of the gallery search, the ideas considered, and what informed the choice of MoveNotice.

## Work generated with AI

- The workspace, package setup and lockfile, ignore rules and environment examples.
- The Solidity contracts, first drafts, Foundry tests, precompile mocks and deploy script under `contracts/` and `audit/`.
- The CLI, account and window handling, logging, shared ABI and signed-message encoding under `cli/` and `shared/`.
- The web interface, wallet discovery and mocked integration tests under `web/`.
- The test report, demo script, audit worksheet, README, licensing text and cover.

## Human contributions

The builder provided the feature brief and selected the project. The builder owns design review, the funded testnet accounts, faucet use, key registration, EVM windows, deployment, both QCAI stages, the video, any final edits and publication.

**Builder to complete.** Record what you actually reviewed, modified and ran. Add confirmed testnet transaction links, the two audit reports and the demo link. These steps were pending when the implementation was handed over.

## Verification and AI risks

SDK declarations and source were checked before use. The official workshop and the chain documentation provided the reference behavior for keys and EVM admission. Foundry tests cover contract behavior with local precompile stand-ins. TypeScript and Solidity tests pin the same golden bytes. A real ML-DSA-87 test checks key and signature sizes and rejects a modified signature. Browser tests use mocked RPC calls. See [TEST_RESULTS.md](TEST_RESULTS.md).

Potential AI risks include inventing SDK calls, inferring wallet support, misstating audit results and introducing signing or replay errors. The implementation pins package versions, takes wallet support from provider behavior, validates files against the chain’s nonce and message view, and leaves audit results for the builder to fill in after running the audits.

**Builder to complete.** Add the fixes made after Stage 1, the regression tests and the Stage 2 outcome. Record any live-test discrepancies and how you resolved them.
