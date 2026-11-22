import { useState, type FormEvent } from "react";
import { type Address, type Hex } from "viem";
import { readTarget } from "../../../shared/addresses";
import { movedRecipient } from "../../../shared/errors";
import { readAmount } from "../../../shared/payment";
import { checkPayment, client, describeError, simulatePayment, type PaymentCheck } from "../lib/chain";
import { sendWithWallet, type Wallet } from "../lib/wallet";
import { CopyCommand, Feedback, Section, StatusPill, TxLink, remaining, useChainClock, utc } from "../ui";

type Checked = { recipient: Address; amount: string; value: bigint; result: PaymentCheck };

export function SendScreen({ board, guard, wallet }: { board?: Address; guard?: Address; wallet?: Wallet }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [checked, setChecked] = useState<Checked>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [simulation, setSimulation] = useState("");
  const [hash, setHash] = useState<Hex>();
  const configured = !!board && !!guard;
  const now = useChainClock(checked?.result.timestamp);
  const result = checked?.result;
  const expiredPending = result?.status === 1 && result.effectiveAt <= now;
  const allowed = !!checked && result?.ok && !expiredPending && !hash;

  function reset() {
    setChecked(undefined);
    setSimulation("");
    setError("");
    setHash(undefined);
  }

  async function check(input: string) {
    if (!board || !guard) return;
    reset();
    setBusy(true);
    try {
      const to = readTarget(input);
      const value = readAmount(amount);
      const state = await checkPayment(guard, board, to);
      setChecked({ recipient: to, amount: amount.trim(), value, result: state });
      if (state.ok && wallet) {
        await simulatePayment(guard, to, value, wallet.account);
        setSimulation("Payment simulation passed.");
      }
    } catch (issue) {
      const moved = movedRecipient(issue);
      if (moved && board && guard) {
        try {
          const state = await checkPayment(guard, board, moved.old);
          setChecked({ recipient: moved.old, amount: amount.trim(), value: readAmount(amount), result: state });
        } catch { setError("The move status changed. Check the recipient again."); }
      } else {
        setError(describeError(issue, "The check or simulation failed. Confirm the sender has test QOR and try again."));
      }
    } finally { setBusy(false); }
  }

  async function send() {
    if (!board || !guard || !wallet?.sending || !checked || !allowed) return;
    setBusy(true);
    setError("");
    setSimulation("");
    try {
      const fresh = await checkPayment(guard, board, checked.recipient);
      setChecked({ ...checked, result: fresh });
      if (!fresh.ok) return;
      const data = await simulatePayment(guard, checked.recipient, checked.value, wallet.account);
      const tx = await sendWithWallet(wallet, guard, data, checked.value);
      setHash(tx);
      setSimulation("Submitted. Waiting for confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("Payment reverted on chain. Check the recipient again.");
      setSimulation("Payment confirmed on QoreChain Testnet.");
    } catch (issue) {
      setSimulation("");
      const moved = movedRecipient(issue);
      if (moved) {
        try { setChecked({ ...checked, result: await checkPayment(guard, board, moved.old) }); }
        catch { setError("The move status changed. Check the recipient again."); }
      } else {
        setError(describeError(issue, "Could not send. Check the EVM window, balance and wallet network."));
      }
    } finally { setBusy(false); }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void check(recipient);
  }

  return <Section title="Guarded send" description="Check a recipient against MoveNotice before sending test QOR.">
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">Recipient address
          <input value={recipient} onChange={(event) => { setRecipient(event.target.value); reset(); }}
            placeholder="0x… or qor1…" autoCapitalize="none" spellCheck={false} required disabled={!configured || busy} />
        </label>
        <label className="field">Amount (QOR)
          <input value={amount} onChange={(event) => { setAmount(event.target.value); reset(); }}
            placeholder="0.01" inputMode="decimal" required disabled={!configured || busy} />
        </label>
      </div>
      <button className="button primary" type="submit" disabled={!configured || busy}>{busy ? "Working…" : "Check recipient"}</button>
    </form>
    {result && <div className="send-result">
      <div className="result-heading"><h3>Recipient check</h3><StatusPill status={result.status} /></div>
      {result.status === 2 && <Feedback tone="danger">
        <strong>Refused.</strong> This account moved to <code>{result.suggested}</code> on {utc(result.effectiveAt)}.
        <button type="button" className="button secondary small" disabled={busy} onClick={() => {
          setRecipient(result.suggested);
          void check(result.suggested);
        }}>Send to suggested address instead</button>
      </Feedback>}
      {result.status === 1 && <Feedback tone="warning">
        {expiredPending ? "The delay elapsed. Check the recipient again before sending." : <>
          A move to <code>{result.suggested}</code> is pending. {remaining(result.effectiveAt - now)}.
          The move takes effect at {utc(result.effectiveAt)}.
        </>}
      </Feedback>}
      {result.status === 0 && <Feedback tone="good">No move notice found. Use this as a first check and verify the address with its owner.</Feedback>}
    </div>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    {simulation && <Feedback tone="good">{simulation}</Feedback>}
    {hash && <p><TxLink hash={hash} /></p>}
    {allowed && checked && (wallet?.sending && !error
      ? <button type="button" className="button primary" disabled={busy} onClick={() => void send()}>Send with wallet</button>
      : <CopyCommand command={`pnpm notice pay ${checked.recipient} ${checked.amount}`} />)}
  </Section>;
}
