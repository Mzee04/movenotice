import { useRef, useState, type FormEvent } from "react";
import { type Address } from "viem";
import { nativeAddress, readTarget } from "../../../shared/addresses";
import { describeError, followMove, readMove, recentEvents, type BoardEvent, type MoveView } from "../lib/chain";
import { Feedback, Section, StatusPill, TxLink, remaining, useChainClock, utc } from "../ui";

export function Lookup({ contract }: { contract?: Address }) {
  const [input, setInput] = useState("");
  const [address, setAddress] = useState<Address>();
  const [move, setMove] = useState<MoveView>();
  const [path, setPath] = useState<readonly [Address, number]>();
  const [events, setEvents] = useState<BoardEvent[]>();
  const [eventError, setEventError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const now = useChainClock(move?.timestamp);
  const effective = move && move.status === 1 && move.effectiveAt <= now;
  const status = move && (effective ? 2 : move.status);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contract) return;
    const id = ++request.current;
    setMove(undefined);
    setEvents(undefined);
    setPath(undefined);
    setEventError(false);
    setError("");
    setBusy(true);
    try {
      const account = readTarget(input);
      setAddress(account);
      const [record, hops] = await Promise.all([readMove(contract, account), followMove(contract, account)]);
      if (request.current !== id) return;
      setMove(record);
      setPath(hops);
      void recentEvents(contract, account).then((result) => {
        if (request.current === id) setEvents(result);
      }).catch(() => {
        if (request.current === id) setEventError(true);
      });
    } catch (issue) {
      if (request.current === id) setError(describeError(issue, "The testnet lookup failed. Try again."));
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  return (
    <Section title="Address lookup" description="Enter a wallet address to see its current move notice.">
      <form className="lookup-form" onSubmit={search}>
        <label className="field">
          Account address
          <input autoCapitalize="none" spellCheck={false} placeholder="0x… or qor1…" value={input}
            onChange={(event) => setInput(event.target.value)} disabled={!contract || busy} required />
        </label>
        <button className="button primary" type="submit" disabled={!contract || busy}>{busy ? "Checking…" : "Look up address"}</button>
      </form>
      {error && <Feedback tone="danger">{error}</Feedback>}
      {!contract && <p className="help">The board will be available here after deployment.</p>}
      {address && move && status !== undefined && <div className="lookup-results">
        <div className="result-heading"><h3>Move status</h3><StatusPill status={status} /></div>
        <dl className="facts">
          <div><dt>Account</dt><dd><code>{address}</code><code>{nativeAddress(address)}</code></dd></div>
          {status !== 0 && <>
            <div><dt>Target</dt><dd><code>{move.to}</code></dd></div>
            <div><dt>Effective at</dt><dd>{utc(move.effectiveAt)}{status === 1 && <span className="muted"> · {remaining(move.effectiveAt - now)}</span>}</dd></div>
          </>}
          {path && <div><dt>Final path at lookup</dt><dd><code>{path[0]}</code><span>{path[1]} {path[1] === 1 ? "hop" : "hops"}</span></dd></div>}
        </dl>
        {status === 0 && <Feedback tone="good">No move notice found. Use this as a first check and verify the address with its owner.</Feedback>}
        <h3 className="event-heading">Recent events</h3>
        {eventError && <p className="help" role="status">Event history is temporarily unavailable. Try the lookup again.</p>}
        {!eventError && !events && <p className="help" role="status">Loading event history…</p>}
        {events?.length === 0 && <p className="help">No events for this account in the recent block range.</p>}
        {!!events?.length && <ol className="event-list">
          {events.map((entry) => <li key={`${entry.hash}-${entry.index}`}>
            <div><strong>{entry.kind === "MovePosted" ? "Move posted" : entry.kind === "MoveCancelled" ? "Move cancelled" : "Move finalized"}</strong><code>{entry.to}</code></div>
            <div>{entry.postedAt ? utc(entry.postedAt) : entry.effectiveAt ? utc(entry.effectiveAt) : `Block ${entry.block}`}<TxLink hash={entry.hash} /></div>
          </li>)}
        </ol>}
      </div>}
    </Section>
  );
}
