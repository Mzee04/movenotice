import { type Address, type Hex } from "viem";
import { readAddress, readTarget } from "./addresses";
import { buildMessage, MAX_DELAY, TESTNET_ID, unsigned, type Action } from "./messages";

export function readSignedNotice(
  raw: unknown,
  expected: { contract: Address; account?: Address; kind?: Action["kind"]; nonce?: bigint; now?: bigint },
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid signed notice file.");
  const file = raw as Record<string, unknown>;
  if (file.chainId !== TESTNET_ID) throw new Error("Signed notice has the wrong chain ID.");
  if (file.kind !== "post" && file.kind !== "cancel") throw new Error("Unknown signed action.");
  if (expected.kind && expected.kind !== file.kind) throw new Error("Signed notice has the wrong action.");
  if (typeof file.contract !== "string" || readAddress(file.contract) !== expected.contract) {
    throw new Error("Signed notice has the wrong contract.");
  }
  if (typeof file.account !== "string") throw new Error("Signed notice is missing its account.");
  const account = readTarget(file.account);
  if (expected.account && account !== expected.account) throw new Error("Signed notice has the wrong account.");
  const nonce = unsigned(file.nonce, "nonce", 256);
  if (expected.nonce !== undefined && nonce !== expected.nonce) throw new Error("Signed notice has a stale nonce.");
  const validUntil = unsigned(file.validUntil, "expiry");
  if (expected.now !== undefined && validUntil < expected.now) throw new Error("Signed notice has expired.");
  const base = { account, contract: expected.contract, chainId: TESTNET_ID, nonce, validUntil };
  let action: Action = { ...base, kind: "cancel" };
  if (file.kind === "post") {
    const delay = typeof file.delay === "number" && Number.isInteger(file.delay) ? BigInt(file.delay) : 0n;
    if (typeof file.to !== "string" || delay < 300n || delay > MAX_DELAY) throw new Error("Invalid signed target or delay.");
    action = { ...base, kind: "post", delay, to: readTarget(file.to, account) };
  }
  const message = buildMessage(action);
  if (typeof file.message !== "string" || file.message.toLowerCase() !== message) {
    throw new Error("Signed notice has different message bytes.");
  }
  if (typeof file.signature !== "string" || !/^0x[0-9a-fA-F]{9254}$/.test(file.signature)) {
    throw new Error("The file must contain a 4627-byte ML-DSA-87 signature.");
  }
  return { action, message, signature: file.signature as Hex };
}

export function noticeCall(action: Action, signature: Hex) {
  if (action.kind === "post") {
    return { functionName: "postMove", args: [action.account, action.to, action.delay, action.validUntil, signature] } as const;
  }
  return { functionName: "cancelMove", args: [action.account, action.validUntil, signature] } as const;
}

export function messageCall(action: Action) {
  if (action.kind === "post") {
    return { functionName: "postMessage", args: [action.account, action.to, action.delay, action.nonce, action.validUntil] } as const;
  }
  return { functionName: "cancelMessage", args: [action.account, action.nonce, action.validUntil] } as const;
}
