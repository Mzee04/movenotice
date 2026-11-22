import { useEffect, useState } from "react";
import { getQorexEip1193Provider, QOREX_RDNS } from "@qorechain/qorex-rainbowkit";
import { isHex, size, toHex, type Address, type Hex } from "viem";
import { readAddress } from "../../../shared/addresses";
import { TESTNET_ID } from "../../../shared/messages";

type Listener = (...args: unknown[]) => void;
export type Provider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: Listener) => void;
  removeListener?: (event: string, listener: Listener) => void;
};
export type Choice = { info: { uuid: string; name: string; rdns: string }; provider: Provider };
export type Wallet = { account: Address; chainId: number; sending: boolean; choice: Choice };

function invalidParams(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const issue = error as { code?: number; data?: { originalError?: { code?: number } } };
  return issue.code === -32602 || issue.data?.originalError?.code === -32602;
}

export async function canSend(choice: Choice, chainId: number): Promise<boolean> {
  if (chainId !== TESTNET_ID || choice.info.rdns === QOREX_RDNS) return false;
  try {
    // A request with no transaction object cannot sign or send anything.
    // A wallet with an implemented handler can identify the missing parameter.
    await choice.provider.request({ method: "eth_sendTransaction", params: [] });
  } catch (error) {
    return invalidParams(error);
  }
  return false;
}

async function readIdentity(provider: Provider, connect = false) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: connect ? "eth_requestAccounts" : "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") return undefined;
  return {
    account: readAddress(accounts[0]),
    chainId: typeof chain === "string" && /^0x[\da-f]+$/i.test(chain) ? Number(BigInt(chain)) : 0,
  };
}

export async function sendWithWallet(wallet: Wallet, to: Address, data: Hex, value?: bigint) {
  if (!wallet.sending) throw new Error("Use the CLI to send from this wallet.");
  const provider = wallet.choice.provider;
  const current = await readIdentity(provider);
  if (current?.chainId !== TESTNET_ID || current.account !== wallet.account) {
    throw new Error("The wallet account or network changed. Reconnect and try again.");
  }
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from: current.account, to, data, ...(value === undefined ? {} : { value: toHex(value) }) }],
  });
  if (!isHex(hash) || size(hash) !== 32) throw new Error("The wallet returned an invalid transaction hash.");
  return hash;
}

export function useWallet() {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [wallet, setWallet] = useState<Wallet>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function add(choice: Choice) {
      setChoices((previous) => previous.some((old) => old.provider === choice.provider || old.info.uuid === choice.info.uuid)
        ? previous
        : [...previous, choice].sort((a, b) => Number(b.info.rdns === QOREX_RDNS) - Number(a.info.rdns === QOREX_RDNS)));
    }
    function announce(event: Event) {
      const detail = (event as CustomEvent<Choice>).detail;
      if (detail?.info?.uuid && typeof detail.info.name === "string" && typeof detail.provider?.request === "function") add(detail);
    }
    function discover() {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      const qorex = getQorexEip1193Provider();
      if (qorex) add({
        info: { uuid: QOREX_RDNS, name: "QoreX", rdns: QOREX_RDNS },
        provider: qorex as Provider,
      });
    }
    window.addEventListener("eip6963:announceProvider", announce);
    window.addEventListener("focus", discover);
    discover();
    return () => {
      window.removeEventListener("eip6963:announceProvider", announce);
      window.removeEventListener("focus", discover);
    };
  }, []);

  const choice = wallet?.choice;
  const activeAccount = wallet?.account;
  const chainId = wallet?.chainId;
  useEffect(() => {
    if (!choice) return;
    let active = true;
    let request = 0;
    async function refresh() {
      const id = ++request;
      try {
        const next = await readIdentity(choice!.provider);
        if (!active || id !== request) return;
        if (!next) { setWallet(undefined); return; }
        if (next.account === activeAccount && next.chainId === chainId) return;
        const sending = await canSend(choice!, next.chainId);
        if (active && id === request) setWallet({ ...next, sending, choice: choice! });
      } catch {
        if (active && id === request) setWallet(undefined);
      }
    }
    const provider = choice.provider;
    provider.on?.("accountsChanged", refresh);
    provider.on?.("chainChanged", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", refresh);
      provider.removeListener?.("chainChanged", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [choice, chainId, activeAccount]);

  async function connect(selected: Choice) {
    setError("");
    setBusy(true);
    try {
      const identity = await readIdentity(selected.provider, true);
      if (!identity) throw new Error();
      setWallet({ ...identity, sending: await canSend(selected, identity.chainId), choice: selected });
    } catch {
      setError("Wallet connection was declined or unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return { choices, wallet, connect, error, busy, disconnect: () => setWallet(undefined) };
}
