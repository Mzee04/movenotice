import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, padHex, toEventSelector, zeroAddress, type Address, type Hex } from "viem";
import { nativeAddress, readAddress, readTarget } from "../../shared/addresses";
import golden from "../../shared/golden.json";
import { QORE_EXPLORER } from "../../shared/messages";
import App from "./App";
import { buildMessage, readSignedNotice, type Action } from "./lib/messages";
import { recentEvents } from "./lib/chain";
import { canSend, type Choice, type Wallet } from "./lib/wallet";
import { Lookup } from "./screens/Lookup";
import { utc } from "./ui";
import { MoveRecord, SignedAction } from "./screens/Actions";
import { SendScreen } from "./screens/Send";

const rpc = vi.hoisted(() => ({
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  request: vi.fn(),
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => rpc };
});

vi.mock("./lib/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/chain")>();
  return {
    ...actual,
    board: "0x3333333333333333333333333333333333333333",
    guard: "0x4444444444444444444444444444444444444444",
  };
});

const account = golden.account as Address;
const to = golden.to as Address;
const contract = golden.contract as Address;
const guard = "0x4444444444444444444444444444444444444444";
const now = 1_799_999_500n;
const action: Action = {
  kind: "post", account, to, contract, chainId: golden.chainId,
  delay: BigInt(golden.delay), nonce: BigInt(golden.nonce), validUntil: BigInt(golden.validUntil),
};
const signed = {
  kind: "post", account, to, contract, chainId: golden.chainId, delay: golden.delay, nonce: golden.nonce,
  validUntil: golden.validUntil, message: golden.post, signature: ("0x" + "44".repeat(4627)) as Hex,
};

const provider = { request: vi.fn() };
const choice: Choice = { info: { uuid: "test", name: "Wallet", rdns: "example.wallet" }, provider };
const readOnly: Wallet = { choice, account, chainId: 9800, sending: false };

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubEnv("VITE_DEPLOYMENT_BLOCK", undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request in an offline test"); }));
  rpc.getBlock.mockResolvedValue({ number: 10n, timestamp: now });
  rpc.getBlockNumber.mockResolvedValue(10n);
  rpc.request.mockResolvedValue([]);
  rpc.simulateContract.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Notice lookup and countdown", () => {
  function lookUp() {
    render(<Lookup contract={contract} />);
    fireEvent.change(screen.getByLabelText("Account address"), { target: { value: nativeAddress(account) } });
    fireEvent.click(screen.getByRole("button", { name: "Look up address" }));
  }

  it.each([[0, "NONE"], [1, "PENDING"], [2, "FINAL"]])("renders %i as %s from resolve", async (status, label) => {
    rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "resolve") return [status ? to : zeroAddress, status, status ? now + 600n : 0n];
      if (functionName === "pending") return [zeroAddress, 0n, 0n];
      if (functionName === "resolveFinal") return [account, 0];
      if (functionName === "isMoved") return false;
    });
    lookUp();
    expect((await screen.findByText(label)).className).toContain("status-pill");
    await screen.findByText("No events for this account in the recent block range.");
  });

  it("shows a pending successor alongside the prior final target", async () => {
    const activation = now + 600n;
    rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "resolve") return [to, 2, now - 800n];
      if (functionName === "pending") return [guard, now - 100n, activation];
      if (functionName === "resolveFinal") return [to, 1];
      if (functionName === "isMoved") return false;
    });

    lookUp();

    expect(await screen.findByText("FINAL")).toBeTruthy();
    const next = await screen.findByText(/Next move pending to/);
    expect(next.textContent).toContain(`Next move pending to ${guard}, activates ${utc(activation)} (10 min 00 s left).`);
    expect(screen.queryByText(/The path stops here/)).toBeNull();
  });

  it("warns if the final path stops at an endpoint with its own final move", async () => {
    rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "resolve") return [to, 2, now - 800n];
      if (functionName === "pending") return [zeroAddress, 0n, 0n];
      if (functionName === "resolveFinal") return [guard, 8];
      if (functionName === "isMoved") return true;
    });

    lookUp();

    const warning = await screen.findByText(
      "The path stops here because it loops or is too long. Check this address before sending.",
    );
    expect(warning.className).toContain("warning");
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "isMoved", args: [guard], blockNumber: 10n,
    }));
  });

  it("shows time remaining, then finalizes the view and disables Cancel at zero", () => {
    vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
    render(<MoveRecord move={{
      to, status: 1, effectiveAt: now + 65n, pendingAt: now + 65n, postedAt: now - 535n,
      pendingTo: to, timestamp: now,
    }} onCancel={vi.fn()} />);
    expect(screen.getByText("1 min 05 s left")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel move" }) as HTMLButtonElement).disabled).toBe(false);
    act(() => vi.advanceTimersByTime(65_000));
    expect(screen.getByText("FINAL")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel move" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The cancellation window has closed.")).toBeTruthy();
  });

  it("shows the amber cancellation warning as soon as fewer than two minutes remain", () => {
    vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
    render(<MoveRecord move={{
      to, status: 1, effectiveAt: now + 120n, pendingAt: now + 120n, postedAt: now - 480n,
      pendingTo: to, timestamp: now,
    }} onCancel={vi.fn()} />);
    const message = "Less than 2 minutes left. A cancellation sent now may arrive after the deadline.";
    expect(screen.queryByText(message)).toBeNull();

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByText(message).className).toContain("warning");
  });

  it("pages filtered logs within the RPC limit and reuses cached pages", async () => {
    rpc.getBlockNumber.mockResolvedValue(51_234n);
    await recentEvents(contract, to);
    const calls = rpc.request.mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [{ method, params: [query] }] of calls) {
      expect(method).toBe("eth_getLogs");
      expect(BigInt(query.toBlock) - BigInt(query.fromBlock) + 1n).toBeLessThanOrEqual(10_000n);
      expect(query.topics[1]).toMatch(/22{39}$/);
    }
    const pages = calls.length;
    expect(BigInt(calls.at(-1)![0].params[0].fromBlock)).toBe(1235n);
    await recentEvents(contract, to);
    expect(rpc.request).toHaveBeenCalledTimes(pages);
  });

  it.each([
    { deployment: "500435", floor: 500_435n, pages: 6, target: to },
    { deployment: "200123", floor: 260_000n, pages: 30, target: guard },
  ] as const)("pages back toward deployment block $deployment within the page cap", async ({ deployment, floor, pages, target }) => {
    vi.stubEnv("VITE_DEPLOYMENT_BLOCK", deployment);
    rpc.getBlockNumber.mockResolvedValue(551_234n);

    await recentEvents(contract, target);

    const requests = rpc.request.mock.calls.map(([request]) => request.params[0]);
    expect(requests).toHaveLength(pages);
    expect(BigInt(requests[0].toBlock)).toBe(551_234n);
    expect(BigInt(requests.at(-1).fromBlock)).toBe(floor);
    requests.forEach(({ fromBlock, toBlock }, i) => {
      expect(BigInt(toBlock) - BigInt(fromBlock) + 1n).toBeLessThanOrEqual(10_000n);
      if (i > 0) expect(BigInt(toBlock) + 1n).toBe(BigInt(requests[i - 1].fromBlock));
    });
  });

  it("stops at twelve events before paging back to the deployment block", async () => {
    vi.stubEnv("VITE_DEPLOYMENT_BLOCK", "10000");
    rpc.getBlockNumber.mockResolvedValue(601_234n);
    const log = {
      transactionHash: "0x" + "ab".repeat(32),
      blockNumber: "0x92c31",
      data: encodeAbiParameters([{ type: "uint64" }], [now]),
      topics: [toEventSelector("MoveFinalized(address,address,uint64)"), padHex(account, { size: 32 }), padHex(to, { size: 32 })],
    };
    rpc.request.mockResolvedValueOnce(Array.from({ length: 13 }, (_, i) => ({
      ...log, logIndex: `0x${i.toString(16)}`,
    })));

    const events = await recentEvents(contract, account);

    expect(events).toHaveLength(12);
    expect(events[0]).toMatchObject({ kind: "MoveFinalized", to, index: 12 });
    expect(rpc.request).toHaveBeenCalledTimes(1);
  });
});

describe("Guarded send", () => {
  const sendingWallet: Wallet = { ...readOnly, sending: true };
  const hash = ("0x" + "ab".repeat(32)) as Hex;
  const storageKey = `movenotice:pending-payments:${sendingWallet.chainId}:${account.toLowerCase()}`;

  function setPaymentResponse(result: readonly [boolean, Address, number]) {
    rpc.readContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === "check") return args[0] === to ? [true, zeroAddress, 0] : result;
      if (functionName === "resolve") return [result[1], result[2], now + 600n];
    });
  }

  function checkRecipient(recipient: string = account, amount = "0.01") {
    fireEvent.change(screen.getByLabelText("Recipient address"), { target: { value: recipient } });
    fireEvent.change(screen.getByLabelText("Amount (QOR)"), { target: { value: amount } });
    fireEvent.click(screen.getByRole("button", { name: "Check recipient" }));
  }

  function check(result: readonly [boolean, Address, number], wallet?: Wallet) {
    setPaymentResponse(result);
    const view = render(<SendScreen board={contract} guard={guard} wallet={wallet} configMatches />);
    checkRecipient();
    return view;
  }

  function sendButton() {
    return screen.getByRole<HTMLButtonElement>("button", { name: "Send with wallet" });
  }

  function storePendingPayment() {
    window.localStorage.setItem(storageKey, JSON.stringify([{ hash, recipient: account, value: "10000000000000000" }]));
  }

  it("refuses a final move and rechecks the suggested recipient on selection", async () => {
    check([false, to, 2], { ...readOnly, sending: true });
    expect(await screen.findByText("Refused.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send with wallet" })).toBeNull();
    expect(rpc.simulateContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send to suggested address instead" }));
    expect((screen.getByLabelText("Recipient address") as HTMLInputElement).value).toBe(to);
    expect(await screen.findByText("NONE")).toBeTruthy();
    await waitFor(() => expect(rpc.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ args: [to] })));
  });

  it("rejects a suggested system address before checking or simulating payment", async () => {
    const system = "0x000000000000000000000000000000000000ffff";
    check([false, system, 2], { ...readOnly, sending: true });
    await screen.findByText("Refused.");
    const calls = rpc.readContract.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Send to suggested address instead" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent", "Choose a normal account address; funds sent to system addresses cannot be recovered.",
    );
    expect(rpc.readContract).toHaveBeenCalledTimes(calls);
    expect(rpc.simulateContract).not.toHaveBeenCalled();
  });

  it("warns about a pending move and keeps the CLI option", async () => {
    check([true, to, 1], readOnly);
    expect(await screen.findByText(/10 min 00 s left/)).toBeTruthy();
    expect(await screen.findByText(`pnpm notice pay ${account} 0.01`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send with wallet" })).toBeNull();
  });

  it("allows an unmoved recipient and reports successful simulation", async () => {
    check([true, zeroAddress, 0], { ...readOnly, sending: true });
    expect(await screen.findByText(/No move notice found/)).toBeTruthy();
    expect(await screen.findByText("Payment simulation passed.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send with wallet" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a pending hash visible after checking a different recipient and reopening the screen", async () => {
    rpc.getTransactionReceipt.mockRejectedValue(new Error("Receipt unavailable"));
    provider.request.mockImplementation(async ({ method }) => {
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x2648";
      if (method === "eth_sendTransaction") return hash;
      throw new Error("Unexpected wallet request");
    });
    const first = check([true, zeroAddress, 0], sendingWallet);
    await screen.findByText("Payment simulation passed.");
    fireEvent.click(sendButton());

    expect((await screen.findByRole("link", { name: hash })).getAttribute("href")).toBe(`${QORE_EXPLORER}/tx/${hash}`);
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual([
      { hash, recipient: account, value: "10000000000000000" },
    ]);
    expect(rpc.getTransactionReceipt).toHaveBeenCalledWith({ hash });

    checkRecipient(to);
    await screen.findByText("Payment simulation passed.");
    expect(sendButton().disabled).toBe(false);
    expect(screen.getByText(/Previous payment still pending/)).toBeTruthy();

    first.unmount();
    rpc.getTransactionReceipt.mockClear();
    render(<SendScreen board={contract} guard={guard} configMatches />);
    expect(await screen.findByRole("link", { name: hash })).toBeTruthy();
    expect(rpc.getTransactionReceipt).toHaveBeenCalledWith({ hash });
  });

  it("blocks the same address and amount after reload while the receipt is unknown", async () => {
    storePendingPayment();
    rpc.getTransactionReceipt.mockRejectedValue(new Error("RPC unavailable"));
    setPaymentResponse([true, zeroAddress, 0]);
    render(<SendScreen board={contract} guard={guard} wallet={sendingWallet} configMatches />);

    checkRecipient(nativeAddress(account), "0.010");
    await screen.findByText("Payment simulation passed.");
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(sendButton());
    expect(provider.request).not.toHaveBeenCalled();
    expect(screen.getByText(/Previous payment still pending/)).toBeTruthy();
  });

  it("uses the selected sender’s Testnet history when a wallet is connected", async () => {
    storePendingPayment();
    const otherChainKey = `movenotice:pending-payments:1:${to.toLowerCase()}`;
    window.localStorage.setItem(otherChainKey, window.localStorage.getItem(storageKey)!);
    check([true, zeroAddress, 0], { ...sendingWallet, account: to });

    await screen.findByText("Payment simulation passed.");
    expect(screen.queryByText(/Previous payment still pending/)).toBeNull();
    expect(sendButton().disabled).toBe(false);
    expect(rpc.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("checks storage again before asking the wallet to pay", async () => {
    rpc.getTransactionReceipt.mockRejectedValue(new Error("Receipt unavailable"));
    check([true, zeroAddress, 0], sendingWallet);
    await screen.findByText("Payment simulation passed.");
    storePendingPayment();

    fireEvent.click(sendButton());

    expect(await screen.findByText(/Previous payment still pending/)).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    expect(rpc.getTransactionReceipt).toHaveBeenCalledWith({ hash });
    expect(provider.request).not.toHaveBeenCalled();
  });

  it.each([
    ["success", "Payment confirmed on QoreChain Testnet."],
    ["reverted", "Payment reverted on chain."],
  ])("clears a pending payment when the RPC returns a %s receipt", async (status, message) => {
    storePendingPayment();
    rpc.getTransactionReceipt.mockResolvedValue({ status });
    check([true, zeroAddress, 0], sendingWallet);

    expect(await screen.findByText(message)).toBeTruthy();
    await screen.findByText("Payment simulation passed.");
    expect(screen.queryByText(/Previous payment still pending/)).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it.each(["a different MoveNotice address", "an RPC error"])("disables Guarded send when startup gets %s", async (outcome) => {
    rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName !== "notice") throw new Error("Unexpected contract read");
      if (outcome === "an RPC error") throw new Error("RPC unavailable");
      return to;
    });

    render(<App />);
    await screen.findByRole("heading", { name: "Check before you send" });
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: guard, functionName: "notice" }));

    act(() => {
      window.history.replaceState(null, "", "#send");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Guarded send configuration mismatch.");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Recipient address" }).disabled).toBe(true);
    const checkButton = screen.getByRole<HTMLButtonElement>("button", { name: "Check recipient" });
    expect(checkButton.disabled).toBe(true);
    fireEvent.click(checkButton);
    expect(rpc.readContract).toHaveBeenCalledTimes(1);
    expect(rpc.simulateContract).not.toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("enables Guarded send after verifying the matching MoveNotice address", async () => {
    rpc.readContract.mockResolvedValue(contract);
    window.history.replaceState(null, "", "#send");
    render(<App />);

    expect(screen.getByRole("status").textContent).toBe("Checking GuardedPay configuration…");
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check recipient" }).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Signed-file checks", () => {
  const expected = { contract, account, kind: "post" as const, nonce: 7n, now };
  it.each([
    ["chainId", 1, "wrong chain ID"],
    ["contract", to, "wrong contract"],
    ["nonce", "8", "stale nonce"],
    ["account", to, "wrong account"],
    ["message", "0x01", "different message"],
    ["signature", "0x01", "4627-byte"],
  ])("rejects a wrong %s", (field, replacement, error) => {
    expect(() => readSignedNotice({ ...signed, [field]: replacement }, expected)).toThrow(error);
  });

  it("uses the same post and cancel golden bytes as Solidity", () => {
    expect(buildMessage(action)).toBe(golden.post);
    expect(buildMessage({ ...action, kind: "cancel" })).toBe(golden.cancel);
  });

  it("simulates an imported file and exposes CLI submit for a read-only wallet", async () => {
    rpc.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "nonces" ? 7n : golden.post,
    );
    render(<SignedAction kind="post" contract={contract} wallet={readOnly} draft={() => action} />);
    const file = new File([JSON.stringify(signed)], "signed.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(signed) });
    fireEvent.change(screen.getByLabelText("Load signed notice (.json)"), { target: { files: [file] } });
    expect(await screen.findByText("Simulation passed.")).toBeTruthy();
    expect(rpc.simulateContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "postMove", account }));
    expect(screen.getByText("pnpm notice submit 'notices/signed.json'")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit with wallet" })).toBeNull();
  });
});

describe("Wallet and address input", () => {
  it("rejects zero, self, malformed and invalid-checksum addresses, and accepts qor1", () => {
    expect(() => readTarget(zeroAddress)).toThrow("non-zero");
    expect(() => readTarget(nativeAddress(account), account)).toThrow("different");
    expect(() => readAddress("invalid")).toThrow("valid");
    expect(() => readAddress("0x5aeda56215b167893e80B4fE645BA6d5Bab767DE")).toThrow("checksummed");
    expect(readAddress(nativeAddress(to))).toBe(to);
  });

  it("checks a generic provider without supplying a transaction", async () => {
    provider.request.mockRejectedValue({ code: -32602 });
    expect(await canSend(choice, 9800)).toBe(true);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_sendTransaction", params: [] });
  });

  it("uses CLI fallback for an unsupported provider, wrong network or read-only QoreX", async () => {
    provider.request.mockRejectedValue({ code: 4200 });
    expect(await canSend(choice, 9800)).toBe(false);
    expect(await canSend(choice, 1)).toBe(false);
    expect(await canSend({ ...choice, info: { ...choice.info, rdns: "network.qore.qorex" } }, 9800)).toBe(false);
    expect(provider.request).toHaveBeenCalledTimes(1);
  });
});
