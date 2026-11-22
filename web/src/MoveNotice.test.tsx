import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress, type Address, type Hex } from "viem";
import { nativeAddress, readAddress, readTarget } from "../../shared/addresses";
import golden from "../../shared/golden.json";
import { buildMessage, readSignedNotice, type Action } from "./lib/messages";
import { recentEvents } from "./lib/chain";
import { canSend, type Choice, type Wallet } from "./lib/wallet";
import { Lookup } from "./screens/Lookup";
import { MoveRecord, SignedAction } from "./screens/Actions";
import { SendScreen } from "./screens/Send";

const rpc = vi.hoisted(() => ({
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  request: vi.fn(),
  getBlock: vi.fn(),
  getBlockNumber: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => rpc };
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
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request in an offline test"); }));
  rpc.getBlock.mockResolvedValue({ number: 10n, timestamp: now });
  rpc.getBlockNumber.mockResolvedValue(10n);
  rpc.request.mockResolvedValue([]);
  rpc.simulateContract.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Notice lookup and countdown", () => {
  it.each([[0, "NONE"], [1, "PENDING"], [2, "FINAL"]])("renders %i as %s from resolve", async (status, label) => {
    rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "resolve") return [status ? to : zeroAddress, status, status ? now + 600n : 0n];
      if (functionName === "pending") return [zeroAddress, 0n, 0n];
      if (functionName === "resolveFinal") return [account, 0];
    });
    render(<Lookup contract={contract} />);
    fireEvent.change(screen.getByLabelText("Account address"), { target: { value: nativeAddress(account) } });
    fireEvent.click(screen.getByRole("button", { name: "Look up address" }));
    expect((await screen.findByText(label)).className).toContain("status-pill");
    await screen.findByText("No events for this account in the recent block range.");
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
    await recentEvents(contract, to);
    expect(rpc.request).toHaveBeenCalledTimes(pages);
  });
});

describe("Guarded send", () => {
  function check(result: readonly [boolean, Address, number], wallet?: Wallet) {
    rpc.readContract.mockImplementation(async ({ functionName, args }) => {
      if (functionName === "check") return args[0] === to ? [true, zeroAddress, 0] : result;
      if (functionName === "resolve") return [result[1], result[2], now + 600n];
    });
    render(<SendScreen board={contract} guard={guard} wallet={wallet} />);
    fireEvent.change(screen.getByLabelText("Recipient address"), { target: { value: account } });
    fireEvent.change(screen.getByLabelText("Amount (QOR)"), { target: { value: "0.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Check recipient" }));
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
