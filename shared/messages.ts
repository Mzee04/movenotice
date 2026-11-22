import { encodePacked, type Address } from "viem";

export const TESTNET_ID = 9800;
export const MAX_DELAY = 30n * 24n * 60n * 60n;
export const QORE_REST = "https://api-testnet.qore.host";
export const QORE_RPC = "https://rpc-testnet.qore.host";
export const QORE_EXPLORER = "https://explore.qore.network";
export const PRACTICAL_EXPIRY = 3600n;

type Base = { chainId: number; contract: Address; account: Address; nonce: bigint; validUntil: bigint };
export type Action =
  | (Base & { kind: "post"; to: Address; delay: bigint })
  | (Base & { kind: "cancel" });

export function buildMessage(action: Action) {
  const { chainId, contract, account, nonce, validUntil } = action;
  if (action.kind === "post") {
    return encodePacked(
      ["string", "uint256", "address", "address", "address", "uint64", "uint256", "uint64"],
      ["MoveNotice:post:v1", BigInt(chainId), contract, account, action.to, action.delay, nonce, validUntil],
    );
  }
  return encodePacked(
    ["string", "uint256", "address", "address", "uint256", "uint64"],
    ["MoveNotice:cancel:v1", BigInt(chainId), contract, account, nonce, validUntil],
  );
}

export function unsigned(value: unknown, field: string, bits = 64): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) {
    throw new Error(`Invalid ${field}. Use a whole non-negative number.`);
  }
  const parsed = BigInt(value);
  if (parsed >= 1n << BigInt(bits)) throw new Error(`Invalid ${field}. The number is out of range.`);
  return parsed;
}
