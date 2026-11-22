import { useEffect, useState, type ChangeEvent } from "react";
import { type Address, type Hex } from "viem";
import { readTarget } from "../../../shared/addresses";
import { MAX_DELAY, unsigned, type Action } from "../../../shared/messages";
import { client, describeError, minDelay, previewAction, readMove, validateSigned, zeroAddress, type MoveView } from "../lib/chain";
import { sendWithWallet, type Wallet } from "../lib/wallet";
import { CopyCommand, Feedback, Section, StatusPill, TxLink, remaining, useChainClock, utc } from "../ui";

type Draft = { kind: "post"; to: Address; delay: bigint } | { kind: "cancel" };
type Preview = Awaited<ReturnType<typeof previewAction>>;
type Loaded = { raw: unknown; fileName: string; result: Awaited<ReturnType<typeof validateSigned>> };

function cliSign(action: Action) {
  const command = action.kind === "post" ? `sign-post ${action.to} ${action.delay}` : "sign-cancel";
  return `pnpm notice ${command} --valid-until ${action.validUntil} --nonce ${action.nonce}`;
}

function submitCommand(file: string) {
  const path = ("notices/" + file).replaceAll("'", "'\"'\"'");
  return `pnpm notice submit '${path}'`;
}

export function SignedAction({ kind, contract, wallet, draft, version, onConfirmed }: {
  kind: Action["kind"]; contract: Address; wallet: Wallet; draft: () => Draft;
  version?: string; onConfirmed?: (hash: Hex) => void;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [loaded, setLoaded] = useState<Loaded>();
  const [hash, setHash] = useState<Hex>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(undefined);
    setLoaded(undefined);
    setHash(undefined);
    setMessage("");
    setError("");
  }, [version]);

  async function prepare() {
    setError("");
    setMessage("");
    setLoaded(undefined);
    setHash(undefined);
    setBusy(true);
    try {
      setPreview(await previewAction(contract, wallet.account, draft()));
    } catch (issue) {
      setPreview(undefined);
      setError(describeError(issue, "Could not read the message from testnet."));
    } finally { setBusy(false); }
  }

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setLoaded(undefined);
    setHash(undefined);
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (file.size > 24_000) throw new Error("Signed notice file is too large.");
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); }
      catch { throw new Error("Choose a valid signed notice JSON file."); }
      const result = await validateSigned(raw, contract, wallet.account, kind, preview?.message);
      setLoaded({ raw, fileName: file.name, result });
      setMessage("Simulation passed.");
    } catch (issue) {
      setError(describeError(issue, "The notice simulation failed. Refresh the notice and try again."));
    } finally { setBusy(false); }
  }

  async function send() {
    if (!loaded || !wallet.sending) return;
    setBusy(true);
    setError("");
    try {
      const result = await validateSigned(loaded.raw, contract, wallet.account, kind, preview?.message);
      const tx = await sendWithWallet(wallet, contract, result.data);
      setHash(tx);
      setMessage("Submitted. Waiting for confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("The transaction reverted. Refresh the notice before retrying.");
      setMessage("Confirmed on QoreChain Testnet.");
      onConfirmed?.(tx);
    } catch (issue) {
      setMessage("");
      setError(describeError(issue, "The wallet could not send. Check the EVM window or use the CLI."));
    } finally { setBusy(false); }
  }

  const reviewed = loaded?.result.action ?? preview?.action;
  return (
    <div className="signed-flow">
      <div className="button-row">
        <button type="button" className="button primary" disabled={busy} onClick={() => void prepare()}>
          {busy ? "Working…" : "Preview message"}
        </button>
        <label className={`button secondary file-picker${busy ? " disabled" : ""}`}>
          Load signed notice (.json)
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void load(event)} />
        </label>
      </div>
      {reviewed && <div className="message-panel">
        <div className="result-heading"><h3>{loaded ? "Reviewed signed action" : "Message to sign"}</h3>
          {preview && !loaded && <button type="button" className="text-button" disabled={busy} onClick={() => setPreview(undefined)}>Clear preview</button>}
        </div>
        <dl className="facts">
          {reviewed.kind === "post" && <div><dt>Target and delay</dt><dd><code>{reviewed.to}</code><span>{String(reviewed.delay)} seconds</span></dd></div>}
          <div><dt>Nonce</dt><dd>{String(reviewed.nonce)}</dd></div>
          <div><dt>Signature expires</dt><dd>{utc(reviewed.validUntil)}</dd></div>
        </dl>
        <details className="raw"><summary>Exact message bytes</summary><code>{loaded?.result.message ?? preview?.message}</code></details>
        {!loaded && <CopyCommand command={cliSign(reviewed)} />}
      </div>}
      {message && <Feedback tone="good">{message}{hash && <> <TxLink hash={hash} /></>}
        {kind === "post" && message === "Confirmed on QoreChain Testnet." && <> · <a href="#mine">View my move</a></>}
      </Feedback>}
      {error && <Feedback tone="danger">{error}{hash && <> <TxLink hash={hash} /></>}</Feedback>}
      {loaded && !hash && (wallet.sending ? <div className="stack">
        <button type="button" className="button primary fit" onClick={() => void send()} disabled={busy}>Submit with wallet</button>
        <details className="raw"><summary>Submit from CLI instead</summary><CopyCommand command={submitCommand(loaded.fileName)} /></details>
      </div> : <div className="stack">
        <p className="help">Submit from CLI. Save the signed file in the notices folder.</p>
        <CopyCommand command={submitCommand(loaded.fileName)} />
      </div>)}
    </div>
  );
}

export function PostMove({ contract, wallet }: { contract?: Address; wallet?: Wallet }) {
  const [target, setTarget] = useState("");
  const [delay, setDelay] = useState("");
  const [minimum, setMinimum] = useState<bigint>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!contract) return;
    let active = true;
    void minDelay(contract).then((value) => {
      if (active) { setMinimum(value); setDelay(value.toString()); }
    }).catch(() => {
      if (active) setError("Could not load the board’s minimum delay. Refresh the page to retry.");
    });
    return () => { active = false; };
  }, [contract]);

  function draft(): Draft {
    const seconds = unsigned(delay, "delay");
    if (minimum === undefined || seconds < minimum || seconds > MAX_DELAY) {
      throw new Error(`Choose a delay between ${minimum ?? 300n} and ${MAX_DELAY} seconds.`);
    }
    return { kind: "post", to: readTarget(target, wallet?.account), delay: seconds };
  }

  return <Section title="Create a move notice" description="Choose where your account is moving and how long people have to review the change.">
    {!wallet && <Feedback>Connect the account that is moving to prepare or load a notice.</Feedback>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    <div className="form-grid">
      <label className="field">New account address
        <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="0x… or qor1…" spellCheck={false}
          autoCapitalize="none" disabled={!contract || !wallet} />
      </label>
      <label className="field">Delay (seconds)
        <input type="number" step="1" min={minimum?.toString()} max={MAX_DELAY.toString()} value={delay}
          onChange={(event) => setDelay(event.target.value)} disabled={minimum === undefined || !wallet} />
      </label>
    </div>
    {contract && wallet && minimum !== undefined && <SignedAction key={`${wallet.account}/${target}/${delay}`}
      kind="post" contract={contract} wallet={wallet} draft={draft} />}
  </Section>;
}

export function MoveRecord({ move, onCancel }: { move: MoveView; onCancel: () => void }) {
  const now = useChainClock(move.timestamp);
  const pending = move.pendingTo !== zeroAddress && move.pendingAt > now;
  const elapsed = move.pendingTo !== zeroAddress && move.pendingAt <= now;
  const status = elapsed ? 2 : move.status;
  const to = elapsed ? move.pendingTo : move.to;
  const effectiveAt = elapsed ? move.pendingAt : move.effectiveAt;
  return (
    <div className="move-record">
      <div className="result-heading"><h3>Current status</h3><StatusPill status={status} /></div>
      {status === 0
        ? <p className="help">No move has been posted for this account.</p>
        : <dl className="facts">
            <div><dt>Target</dt><dd><code>{to}</code></dd></div>
            <div><dt>Effective at</dt><dd>{utc(effectiveAt)}</dd></div>
          </dl>}
      {pending && <div className="countdown">
        <span>{status === 2 ? "Next move activates in" : "Cancellation window"}</span>
        <strong>{remaining(move.pendingAt - now)}</strong>
        {status === 2 && <code>{move.pendingTo}</code>}
      </div>}
      {pending || status === 2 ? <button type="button" className="button secondary fit" disabled={!pending} onClick={onCancel}>Cancel move</button> : null}
      {!pending && status === 2 && <p className="help">The cancellation window has closed.</p>}
    </div>
  );
}

export function MyMove({ contract, wallet }: { contract?: Address; wallet?: Wallet }) {
  const [move, setMove] = useState<MoveView>();
  const [error, setError] = useState("");
  const [cancel, setCancel] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [cancelHash, setCancelHash] = useState<Hex>();
  const now = useChainClock(move?.timestamp);
  const account = wallet?.account;
  useEffect(() => {
    if (!contract || !account) return;
    let active = true;
    let running = false;
    async function poll() {
      if (running) return;
      running = true;
      try {
        const next = await readMove(contract!, account!);
        if (active) { setMove(next); setError(""); }
      } catch {
        if (active) setError("Could not refresh the move from testnet.");
      } finally { running = false; }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 8_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [contract, account, refresh]);

  const cancellable = !!move && move.pendingTo !== zeroAddress && move.pendingAt > now;
  return <Section title="My move" description="Review your current notice and the time left to cancel a pending move.">
    {!wallet && <Feedback>Connect a wallet to see its move notice.</Feedback>}
    {wallet && contract && !move && !error && <p className="help" role="status">Reading your move…</p>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    {cancelHash && <Feedback tone="good">Cancellation confirmed. <TxLink hash={cancelHash} /></Feedback>}
    {move && <MoveRecord move={move} onCancel={() => { setCancelHash(undefined); setCancel(true); }} />}
    {cancel && cancellable && wallet && contract && <div className="cancel-flow">
      <div className="result-heading"><h3>Sign a cancellation</h3><button className="text-button" type="button" onClick={() => setCancel(false)}>Close</button></div>
      <SignedAction kind="cancel" contract={contract} wallet={wallet} draft={() => ({ kind: "cancel" })}
        version={move?.pendingAt.toString()} onConfirmed={(hash) => { setCancelHash(hash); setCancel(false); setRefresh((count) => count + 1); }} />
    </div>}
  </Section>;
}
