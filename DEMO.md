# Three-minute MoveNotice demo

Record on QoreChain Testnet with throwaway accounts and test QOR. The explorer should be set to Testnet and all visible times should be UTC. Keep credentials, local environment files and the recovery-code command out of the recording.

## Prepare before recording

- Choose funded coin-60 accounts **A1** and **A2** with proven keys. Choose distinct valid recipients **B1** and **B2**. Keep A1 at status NONE. Set `B1`, `B2` and `A2` as shell variables containing only those public addresses.
- Fund A1, A2 and the deployer with test QOR from the faucet. A1 can also serve as the deployer. Plan funding around the faucet’s 24-hour limit. [Testnet faucet](https://dashboard.qorechain.io/faucet)
- Confirm the 0x address from `pnpm notice status` is exactly the coin-60 account shown in QoreX. For mnemonic credentials, change `QORE_ACCOUNT_INDEX` and check again if the addresses differ. Repeat the check when switching accounts.
- Complete the testnet deployment in the [README](README.md). Have the contract addresses, explorer tabs, cover and the two QCAI reports ready before recording the final version.
- With A2 as the configured CLI account, run `pnpm notice register`, `pnpm notice window:scoped` and `pnpm notice post "$B2" 600` at least ten minutes before recording. Then run `pnpm notice resolve "$A2"` and check for FINAL. Save the post transaction link. `pnpm notice finalize "$A2"` optionally gives the event list an explicit finalization event.
- Restore A1’s credential configuration, connect A1 in the browser and run `pnpm notice window:scoped`. Confirm A1’s address, matching proven key and live window with `pnpm notice status`. Capture the pre-post command `pnpm notice attack-post "$B1"` and its `BLOCKED: BadPqcSignature` output for the later attack segment. It is captured before posting because an active pending move would fail the pending notice check first.
- Keep a known-good simulated result and successful testnet transaction link ready for each write. If the live transaction takes too long, show its simulation and cut to the prepared result. Describe a simulation and a confirmed transaction as separate steps.

## 0:00–0:20 · Problem and app home

Say “Someone messages you, ‘we moved wallets, pay this new address.’ MoveNotice gives you a public signed record to check before sending.” Show the lookup screen and the QoreChain Testnet indicator.

## 0:20–0:50 · Post a signed move

Open **Post a move**, enter B1 and 600 seconds, then select **Preview message**. Show the nonce, UTC expiry and exact bytes. Copy the displayed command, which pins the preview expiry and nonce. It has this shape.

```sh
pnpm notice sign-post "$B1" 600 --valid-until "$EXPIRY" --nonce "$NONCE"
```

Use the displayed numeric values for `EXPIRY` and `NONCE`. Load the generated file and show **Simulation passed**. For QoreX, paste the displayed `pnpm notice submit <file.json>` command. A wallet with transaction support can use **Submit with wallet**. Show the transaction on the explorer and the PENDING countdown under **My move**.

## 0:50–1:15 · Classical-key-only simulation

Show the pre-captured `pnpm notice attack-post "$B1"` output. With A1 pending, run `pnpm notice attack-cancel`. Each uses a different ML-DSA-87 key with A1 as the simulated sender and prints `BLOCKED: BadPqcSignature`. Show that A1 remains PENDING. Explain that both are simulations and the chain sees no transaction.

## 1:15–1:40 · Cancel inside the delay

Under **My move**, select **Cancel move** and **Preview message**. Run the copied command or use the same expiry and nonce in the shell.

```sh
pnpm notice sign-cancel --valid-until "$EXPIRY" --nonce "$NONCE"
pnpm notice submit <cancel-file.json>
```

Load and simulate the cancel file before submitting it. Show the explorer link and A1 returning to NONE. If time is short, show the successful simulation followed by a prepared confirmed cancellation.

## 1:40–2:10 · Look up a final move

Look up A2 by either address form. Point to **FINAL**, B2, the UTC effective time, the final path and the recent events. Say “The contract treats the move as final once the delay ends. Finalizing separately emits an event.” Show the A2 transaction on the explorer.

## 2:10–2:45 · Refuse a stale payment and review the new target

Open **Guarded send** and check A2 with an amount of 0.01 QOR. Show **Refused** and B2 as the suggestion. The CLI can also demonstrate the exact contract refusal.

```sh
pnpm notice simulate-pay "$A2" 0.01
```

Expect `REFUSED: AccountMoved(A2 → B2)` with actual addresses. Select **Send to suggested address instead** and show the fresh check of B2. If B2 has no final move, use the wallet or `pnpm notice pay "$B2" 0.01`. Show the confirmed transaction. If it is slow, show the successful simulation and the prepared receipt.

## 2:45–3:00 · Recap

Say “QoreChain’s scoped EVM window controls where the sender can transact. MoveNotice checks the registered, proven key with `pqcKeyStatus` and the action signature with `pqcVerify`. The tests cover relaying, replay and stale payments. Use this as a first check and verify the new address with the recipient.” Show the repository and test summary.

Replace the placeholders in this script with public addresses and file names in your recording notes.
