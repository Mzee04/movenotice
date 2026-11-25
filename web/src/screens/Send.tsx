import { useRef, useState, type FormEvent } from "react";
import { type Address } from "viem";
import { movedRecipient } from "../../../shared/errors";
import { readAmount, readPaymentRecipient } from "../../../shared/payment";
import { checkPayment, describeError, simulatePayment, type PaymentCheck } from "../lib/chain";
import { repeatsPayment, usePendingPayments } from "../lib/pendingPayments";
import { sendWithWallet, type Wallet } from "../lib/wallet";
import { CopyCommand, Feedback, Section, StatusPill, TxLink, remaining, useChainClock, utc } from "../ui";

type Checked = { recipient: Address; amount: string; value: bigint; result: PaymentCheck };

export function SendScreen({ board, guard, wallet, configMatches }: {
  board?: Address; guard?: Address; wallet?: Wallet; configMatches?: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [checked, setChecked] = useState<Checked>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [simulation, setSimulation] = useState("");
  const sending = useRef(false);
  const { pending, settled, storageError, reconcile, record } = usePendingPayments(wallet?.account);
  const configured = !!board && !!guard && configMatches === true;
  const now = useChainClock(checked?.result.timestamp);
  const result = checked?.result;
  const expiredPending = result?.status === 1 && result.effectiveAt <= now;
  const allowed = configured && !!checked && result?.ok && !expiredPending;
  const blocked = storageError || (!!checked && repeatsPayment(pending, checked.recipient, checked.value));

  function reset() {
    setChecked(undefined);
    setSimulation("");
    setError("");
  }

  async function check(input: string) {
    if (!configured || !board || !guard) return;
    reset();
    setBusy(true);
    try {
      const to = readPaymentRecipient(input);
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
    if (!board || !guard || !wallet?.sending || !checked || !allowed || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setSimulation("");
    try {
      const fresh = await checkPayment(guard, board, checked.recipient);
      setChecked({ ...checked, result: fresh });
      if (!fresh.ok) return;
      const data = await simulatePayment(guard, checked.recipient, checked.value, wallet.account);
      const previous = await reconcile();
      if (!previous || repeatsPayment(previous, checked.recipient, checked.value)) return;
      const hash = await sendWithWallet(wallet, guard, data, checked.value);
      record(hash, checked.recipient, checked.value);
    } catch (issue) {
      setSimulation("");
      const moved = movedRecipient(issue);
      if (moved) {
        try { setChecked({ ...checked, result: await checkPayment(guard, board, moved.old) }); }
        catch { setError("The move status changed. Check the recipient again."); }
      } else {
        setError(describeError(issue, "Could not send. Check the EVM window, balance and wallet network."));
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void check(recipient);
  }

  return <Section title="Guarded send" description="Check a recipient against MoveNotice before sending test QOR.">
    {board && guard && configMatches === undefined && <p role="status">Checking GuardedPay configuration…</p>}
    {configMatches === false && <Feedback tone="danger">
      Guarded send configuration mismatch. Could not verify that GuardedPay uses the configured MoveNotice address.
    </Feedback>}
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
    {pending.map(({ hash }) => <Feedback key={hash} tone="warning">
      Previous payment still pending: <TxLink hash={hash}><code>{hash}</code></TxLink>
    </Feedback>)}
    {storageError && <Feedback tone="danger">Pending payment history could not be saved or read. Restore browser storage to send again.</Feedback>}
    {settled && <Feedback tone={settled.status === "success" ? "good" : "danger"}>
      {settled.status === "success" ? "Payment confirmed on QoreChain Testnet." : "Payment reverted on chain."} <TxLink hash={settled.hash} />
    </Feedback>}
    {allowed && checked && (wallet?.sending && !error
      ? <button type="button" className="button primary" disabled={busy || blocked} onClick={() => void send()}>Send with wallet</button>
      : !blocked && <CopyCommand command={`pnpm notice pay ${checked.recipient} ${checked.amount}`} />)}
  </Section>;
}
