import { parseAbi } from "viem";

export const noticeAbi = parseAbi([
  "function minDelay() view returns (uint64)",
  "function MAX_DELAY() view returns (uint64)",
  "function pending(address account) view returns (address to, uint64 postedAt, uint64 effectiveAt)",
  "function finalTo(address account) view returns (address)",
  "function nonces(address account) view returns (uint256)",
  "function postMessage(address account, address to, uint64 delay, uint256 nonce, uint64 validUntil) view returns (bytes)",
  "function cancelMessage(address account, uint256 nonce, uint64 validUntil) view returns (bytes)",
  "function postMove(address account, address to, uint64 delay, uint64 validUntil, bytes signature)",
  "function cancelMove(address account, uint64 validUntil, bytes signature)",
  "function finalize(address account)",
  "function resolve(address account) view returns (address to, uint8 status, uint64 effectiveAt)",
  "function resolveFinal(address account) view returns (address current, uint8 hops)",
  "function isMoved(address account) view returns (bool)",
  "function timeLeft(address account) view returns (uint64)",
  "event MovePosted(address indexed account, address indexed to, uint256 nonce, uint64 postedAt, uint64 effectiveAt, address relayer)",
  "event MoveCancelled(address indexed account, address indexed to, uint256 nonce, address relayer)",
  "event MoveFinalized(address indexed account, address indexed to, uint64 effectiveAt)",
  "error SignatureExpired()",
  "error BadTarget()",
  "error BadDelay()",
  "error MovePending()",
  "error NoPendingMove()",
  "error AlreadyFinal()",
  "error NotYetEffective()",
  "error KeyNotRegistered()",
  "error KeyNotProven()",
  "error BadKey()",
  "error BadPqcSignature()",
]);

export const payAbi = parseAbi([
  "function pay(address to) payable",
  "function check(address to) view returns (bool ok, address suggested, uint8 status)",
  "event Paid(address indexed sender, address indexed to, uint256 amount, bool movePending)",
  "error AccountMoved(address to, address newAccount)",
  "error TransferFailed()",
]);

export const keyAbi = parseAbi([
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);
export const keyRegistry = "0x0000000000000000000000000000000000000a02";
export const statuses = ["NONE", "PENDING", "FINAL"] as const;
