import { useEffect, useState } from "react";
import { nativeAddress } from "../../shared/addresses";
import { TESTNET_ID } from "../../shared/messages";
import { board, guard, keyStatus, windowStatus } from "./lib/chain";
import { useWallet, type Wallet } from "./lib/wallet";
import { Lookup } from "./screens/Lookup";
import { MyMove, PostMove } from "./screens/Actions";
import { SendScreen } from "./screens/Send";
import { HowItWorks } from "./screens/Help";
import { Feedback } from "./ui";

const pages = {
  lookup: { label: "Look up", icon: "⌕", title: "Check before you send", description: "Look up a wallet address to see if its owner has posted a signed move notice." },
  post: { label: "Post a move", icon: "+", title: "Announce a move", description: "Give others time to review your new address before the move takes effect." },
  mine: { label: "My move", icon: "◷", title: "Track your move", description: "See which address is in effect and how long you have left to cancel a pending change." },
  send: { label: "Guarded send", icon: "◇", title: "Send with a first check", description: "GuardedPay checks the recipient on-chain before forwarding your payment." },
  help: { label: "How it works", icon: "ⓘ", title: "A signed record of a move", description: "Understand what the board checks and what you still need to verify." },
} as const;

type Page = keyof typeof pages;
function currentPage(): Page {
  const fragment = window.location.hash.slice(1);
  return Object.hasOwn(pages, fragment) ? fragment as Page : "lookup";
}

function Identity({ wallet }: { wallet: Wallet }) {
  const [key, setKey] = useState<Awaited<ReturnType<typeof keyStatus>> | null>();
  const [windowInfo, setWindowInfo] = useState<Awaited<ReturnType<typeof windowStatus>> | null>();
  useEffect(() => {
    let active = true;
    function refresh() {
      void keyStatus(wallet.account).then((value) => { if (active) setKey(value); }).catch(() => { if (active) setKey(null); });
      void windowStatus(wallet.account).then((value) => { if (active) setWindowInfo(value); }).catch(() => { if (active) setWindowInfo(null); });
    }
    refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [wallet.account]);
  return <div className="identity">
    <div><small>Connected account</small><code>{wallet.account}</code><code>{nativeAddress(wallet.account)}</code></div>
    <div><small>Post-quantum key</small><strong>{key === undefined ? "Checking…" : !key ? "Unavailable" : key.ready ? "Registered · Proven" : key.registered ? key.proven ? "Unsupported key" : "Registered · Unproven" : "Unregistered"}</strong></div>
    <div><small>EVM window</small><strong>{windowInfo === undefined ? "Checking…" : !windowInfo ? "Unavailable" : !windowInfo.found ? "No window" : windowInfo.live ? "Live" : "Closed"}</strong>
      {windowInfo?.found && <span className="help">{String(windowInfo.remainingBlocks)} blocks · {String(windowInfo.remainingTxs)} transactions</span>}
    </div>
    <div><small>Wallet sending</small><strong>{wallet.chainId !== TESTNET_ID ? "Switch to Testnet" : wallet.sending ? "Available" : "Use local CLI"}</strong></div>
  </div>;
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [walletOpen, setWalletOpen] = useState(false);
  const { choices, wallet, connect, error, busy, disconnect } = useWallet();
  const selected = pages[page];
  const missing = !board || !guard;

  useEffect(() => {
    function syncPage() { if (window.location.hash !== "#content") setPage(currentPage()); }
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  return <div className="app-shell">
    <a className="skip" href="#content">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#lookup" aria-label="MoveNotice home">
        <span className="brand-mark" aria-hidden="true"><i></i><i></i></span>
        <span>Move<span>Notice</span></span>
      </a>
      <nav aria-label="Main navigation">
        {(Object.keys(pages) as Page[]).map((item) => <a key={item} href={`#${item}`} aria-current={page === item ? "page" : undefined}>
          <span className="nav-icon" aria-hidden="true">{pages[item].icon}</span>{pages[item].label}
        </a>)}
      </nav>
      <div className="sidebar-foot"><span className="network-dot"></span><div><strong>QoreChain</strong><small>Testnet · 9800</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <span className="network"><span className="network-dot"></span>QoreChain Testnet</span>
        <div className="wallet-control">
          <button type="button" className="button connect" aria-expanded={walletOpen} aria-controls="wallet-panel" onClick={() => setWalletOpen((open) => !open)}>
            <span className="wallet-icon" aria-hidden="true"></span>
            {wallet ? wallet.choice.info.name : "Connect wallet"}
          </button>
          {walletOpen && <div id="wallet-panel" className="wallet-menu">
            {wallet ? <>
              <p className="help">Connected to {wallet.choice.info.name}</p>
              <button type="button" className="button secondary" onClick={() => { disconnect(); setWalletOpen(false); }}>Disconnect</button>
            </> : <>
              <strong>Choose a wallet</strong>
              {choices.map((item) => <button key={item.info.uuid} type="button" className="button secondary" disabled={busy} onClick={() => void connect(item)}>
                {item.info.name}
              </button>)}
              {!choices.length && <p className="help">Open QoreX or an EIP-6963 compatible wallet, then return here.</p>}
              {busy && <p className="help" role="status">Waiting for wallet…</p>}
            </>}
            {error && <Feedback tone="danger">{error}</Feedback>}
          </div>}
        </div>
      </header>
      <main id="content" tabIndex={-1}>
        <div className="hero">
          <div className="hero-copy">
            <h1>{selected.title}</h1>
            <p>{selected.description}</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-line"></div><div className="hero-node start"></div>
            <div className="hero-node time"><i></i></div><div className="hero-node finish"></div>
          </div>
        </div>
        {wallet && <Identity key={wallet.account} wallet={wallet} />}
        {missing && page !== "help" && <Feedback tone="warning">
          <strong>{!board ? "MoveNotice is not deployed yet." : "GuardedPay is not configured yet."}</strong>
          <span> Add the testnet contract addresses to the web environment to enable live checks.</span>
        </Feedback>}
        {page === "lookup" && <Lookup contract={board} />}
        {page === "post" && <PostMove key={wallet?.account} contract={board} wallet={wallet} />}
        {page === "mine" && <MyMove key={wallet?.account} contract={board} wallet={wallet} />}
        {page === "send" && <SendScreen key={wallet?.account} board={board} guard={guard} wallet={wallet} />}
        {page === "help" && <HowItWorks />}
        {page === "lookup" && <div className="status-guide" aria-label="Move status meanings">
          <article><span className="guide-mark none" aria-hidden="true"></span><h3>No notice</h3><p>No move is recorded for the account.</p></article>
          <article><span className="guide-mark pending" aria-hidden="true"></span><h3>Pending</h3><p>A move is scheduled and can still be cancelled.</p></article>
          <article><span className="guide-mark final" aria-hidden="true"></span><h3>Final</h3><p>A signed move is already in effect.</p></article>
        </div>}
        <footer className="footer"><span>MoveNotice · Build Before Q-Day</span><a href="https://docs.qorechain.io/appendix/networks/" target="_blank" rel="noreferrer">Network details</a></footer>
      </main>
    </div>
  </div>;
}
