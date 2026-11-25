import { evmWindowStatus, qorechainTestnet } from "@qorechain/evm";
import { createPublicClient, decodeEventLog, encodeFunctionData, http, isAddressEqual, padHex, parseAbi, toEventSelector, toHex, zeroAddress, type Address, type Hex } from "viem";
import { keyAbi, keyRegistry, noticeAbi, payAbi } from "../../../shared/abi";
import { nativeAddress, readTarget } from "../../../shared/addresses";
import { onchainMessage, simulateAction } from "../../../shared/contractActions";
import { contractRevert } from "../../../shared/errors";
import { PRACTICAL_EXPIRY, QORE_REST, TESTNET_ID, type Action } from "../../../shared/messages";
import { readSignedNotice } from "../../../shared/notices";

export const client = createPublicClient({ chain: qorechainTestnet, transport: http() });

function configured(input?: string) {
  try { return input ? readTarget(input) : undefined; }
  catch { return undefined; }
}

export const board = configured(import.meta.env.VITE_MOVENOTICE_ADDRESS);
export const guard = configured(import.meta.env.VITE_GUARDEDPAY_ADDRESS);

const guardNoticeAbi = parseAbi(["function notice() view returns (address)"]);

export async function verifyGuardedPayConfig(boardAddress: Address, guardAddress: Address) {
  try {
    const notice = await client.readContract({ address: guardAddress, abi: guardNoticeAbi, functionName: "notice" });
    return isAddressEqual(notice, boardAddress);
  } catch {
    return false;
  }
}

export async function keyStatus(account: Address) {
  const [registered, algorithm, key, proven] = await client.readContract({
    address: keyRegistry, abi: keyAbi, functionName: "pqcKeyStatus", args: [account],
  });
  return { registered, proven, ready: registered && proven && algorithm === 1 && key.length === 5186 };
}

export async function windowStatus(account: Address) {
  const address = nativeAddress(account);
  const rest = import.meta.env.VITE_QORE_REST_URL || QORE_REST;
  try {
    return await evmWindowStatus({ rest, address });
  } catch {
    return evmWindowStatus({ rest: new URL("/lcd-testnet", window.location.origin).href, address });
  }
}

export function minDelay(address: Address) {
  return client.readContract({ address, abi: noticeAbi, functionName: "minDelay" });
}

export type MoveView = {
  to: Address;
  status: number;
  effectiveAt: bigint;
  pendingTo: Address;
  pendingAt: bigint;
  postedAt: bigint;
  timestamp: bigint;
};

async function readMoveAt(address: Address, account: Address, blockNumber: bigint, timestamp: bigint): Promise<MoveView> {
  const [[to, status, effectiveAt], [pendingTo, postedAt, pendingAt]] = await Promise.all([
    client.readContract({ address, abi: noticeAbi, functionName: "resolve", args: [account], blockNumber }),
    client.readContract({ address, abi: noticeAbi, functionName: "pending", args: [account], blockNumber }),
  ]);
  return { to, status, effectiveAt, pendingTo, pendingAt, postedAt, timestamp };
}

export async function readMove(address: Address, account: Address): Promise<MoveView> {
  const { number, timestamp } = await client.getBlock();
  return readMoveAt(address, account, number, timestamp);
}

async function followMove(address: Address, account: Address, blockNumber: bigint) {
  const [endpoint, hops] = await client.readContract({
    address, abi: noticeAbi, functionName: "resolveFinal", args: [account], blockNumber,
  });
  const endpointMoved = await client.readContract({
    address, abi: noticeAbi, functionName: "isMoved", args: [endpoint], blockNumber,
  });
  return { endpoint, hops, endpointMoved };
}

export async function lookupMove(address: Address, account: Address) {
  const { number, timestamp } = await client.getBlock();
  return Promise.all([readMoveAt(address, account, number, timestamp), followMove(address, account, number)]);
}

type Draft = { kind: "post"; to: Address; delay: bigint } | { kind: "cancel" };
export async function previewAction(contract: Address, account: Address, draft: Draft) {
  const [nonce, { timestamp }] = await Promise.all([
    client.readContract({ address: contract, abi: noticeAbi, functionName: "nonces", args: [account] }),
    client.getBlock(),
  ]);
  const action: Action = { ...draft, chainId: TESTNET_ID, contract, account, nonce, validUntil: timestamp + PRACTICAL_EXPIRY };
  return { action, message: await onchainMessage(client, action) };
}

export async function validateSigned(raw: unknown, contract: Address, account: Address, kind: Action["kind"], preview?: Hex) {
  const [nonce, { timestamp }] = await Promise.all([
    client.readContract({ address: contract, abi: noticeAbi, functionName: "nonces", args: [account] }),
    client.getBlock(),
  ]);
  const parsed = readSignedNotice(raw, { contract, account, kind, nonce, now: timestamp });
  if (preview && parsed.message !== preview) throw new Error("The signed file differs from this preview. Clear the preview to import it.");
  await onchainMessage(client, parsed.action);
  const data = await simulateAction(client, parsed.action, parsed.signature, account);
  return { ...parsed, data };
}

const eventAbi = noticeAbi.filter((item) => item.type === "event");
const eventTopics = eventAbi.map((event) => toEventSelector(event));
const eventPage = 10_000n;
const cache = new Map<string, { expires: number; result: Promise<BoardEvent[]> }>();

export type BoardEvent = {
  kind: typeof eventAbi[number]["name"];
  to: Address;
  block: bigint;
  index: number;
  hash: Hex;
  postedAt?: bigint;
  effectiveAt?: bigint;
};

function readEventPage(address: Address, account: Address, fromBlock: bigint, toBlock: bigint) {
  const key = `${address}/${account}/${fromBlock}/${toBlock}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  const result = client.request({
    method: "eth_getLogs",
    params: [{
      address, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock),
      topics: [eventTopics, padHex(account, { size: 32 })],
    }],
  }).then((logs) => logs.flatMap((log): BoardEvent[] => {
    if (!log.transactionHash || log.blockNumber === null || log.logIndex === null || log.removed) return [];
    const decoded = decodeEventLog({ abi: eventAbi, data: log.data, topics: log.topics, strict: true });
    const { to, ...times } = decoded.args;
    return [{
      kind: decoded.eventName, to, block: BigInt(log.blockNumber), index: Number(log.logIndex),
      hash: log.transactionHash,
      postedAt: "postedAt" in times ? times.postedAt : undefined,
      effectiveAt: "effectiveAt" in times ? times.effectiveAt : undefined,
    }];
  })).catch((error: unknown) => {
    if (cache.get(key)?.result === result) cache.delete(key);
    throw error;
  });
  cache.set(key, { expires: Date.now() + 30_000, result });
  return result;
}

export async function recentEvents(address: Address, account: Address) {
  const tip = await client.getBlockNumber();
  const recentFloor = tip >= 5n * eventPage ? tip - 5n * eventPage + 1n : 0n;
  const configuredBlock = import.meta.env.VITE_DEPLOYMENT_BLOCK;
  const floor = configuredBlock && /^\d+$/.test(configuredBlock) ? BigInt(configuredBlock) : recentFloor;
  const results: BoardEvent[] = [];
  for (let to = tip, pages = 0; to >= floor && results.length < 12 && pages < 30; pages++) {
    // Align pages to fixed block boundaries so earlier pages survive a refresh.
    const boundary = to - to % eventPage;
    const from = floor > boundary ? floor : boundary;
    results.push(...await readEventPage(address, account, from, to));
    if (from === floor) break;
    to = from - 1n;
  }
  return results.sort((a, b) => a.block === b.block ? b.index - a.index : a.block < b.block ? 1 : -1).slice(0, 12);
}

export async function checkPayment(address: Address, boardAddress: Address, recipient: Address) {
  const { number: blockNumber, timestamp } = await client.getBlock();
  const [[ok, suggested, status], [, , effectiveAt]] = await Promise.all([
    client.readContract({ address, abi: payAbi, functionName: "check", args: [recipient], blockNumber }),
    client.readContract({ address: boardAddress, abi: noticeAbi, functionName: "resolve", args: [recipient], blockNumber }),
  ]);
  return { ok, suggested, status, effectiveAt, timestamp };
}

export type PaymentCheck = Awaited<ReturnType<typeof checkPayment>>;

export async function simulatePayment(address: Address, recipient: Address, value: bigint, sender: Address) {
  await client.simulateContract({ address, abi: payAbi, account: sender, functionName: "pay", args: [recipient], value });
  return encodeFunctionData({ abi: payAbi, functionName: "pay", args: [recipient] });
}

const revertMessages: Record<string, string> = {
  BadPqcSignature: "The contract refused the ML-DSA-87 signature.",
  SignatureExpired: "The signature expired. Sign a fresh notice.",
  BadDelay: "The delay is outside the board’s limits.",
  BadTarget: "The target address is invalid.",
  KeyNotProven: "The registered key needs proof of possession.",
  KeyNotRegistered: "This account has no registered ML-DSA-87 key.",
  BadKey: "The on-chain key is not a valid ML-DSA-87 key.",
  AlreadyFinal: "The cancellation window has closed.",
  NoPendingMove: "There is no pending notice to cancel.",
  MovePending: "Cancel the pending move before posting a new one.",
  TransferFailed: "The recipient refused the payment.",
};

export function describeError(error: unknown, fallback: string) {
  const revert = contractRevert(error);
  if (revert) return revertMessages[revert.errorName] ?? fallback;
  return error instanceof Error && error.constructor === Error ? error.message : fallback;
}

export { zeroAddress };
