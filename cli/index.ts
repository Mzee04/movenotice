import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { qorechainTestnet } from "@qorechain/evm";
import { generatePqcRecoveryCode, generatePqcKeypair, pqcSign } from "@qorechain/sdk";
import { BaseError, createPublicClient, createWalletClient, hexToBytes, http, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { noticeAbi, payAbi, statuses } from "../shared/abi";
import { nativeAddress, readAddress, readTarget } from "../shared/addresses";
import { onchainMessage, simulateAction } from "../shared/contractActions";
import { contractRevert, movedRecipient } from "../shared/errors";
import { PRACTICAL_EXPIRY, QORE_EXPLORER, TESTNET_ID, unsigned, type Action } from "../shared/messages";
import { readSignedNotice } from "../shared/notices";
import { readAmount } from "../shared/payment";
import { accountStatus, localAccount, openWindow, register, requireOwnedKey } from "./account";
import { logError } from "./logger";

const pub = createPublicClient({
  chain: qorechainTestnet,
  transport: http(undefined, { fetchOptions: { headers: { "User-Agent": "MoveNotice CLI" } } }),
});
const manifestPath = "deployments/testnet.json";

async function deployment(requireManifest = false) {
  let record: Record<string, unknown> = {};
  try {
    record = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!record || record.chainId !== TESTNET_ID) throw new Error("Deployment manifest has the wrong chain ID.");
  } catch (error) {
    if (requireManifest || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const address = (value: unknown) => typeof value === "string" && value.trim() ? readTarget(value) : undefined;
  return {
    notice: address((requireManifest ? undefined : process.env.MOVENOTICE_ADDRESS?.trim()) || record.moveNotice),
    pay: address((requireManifest ? undefined : process.env.GUARDEDPAY_ADDRESS?.trim()) || record.guardedPay),
  };
}

async function needContract(which: "notice" | "pay"): Promise<Address> {
  const result = (await deployment())[which];
  if (!result) throw new Error("Set the contract address or create deployments/testnet.json.");
  return result;
}

function printHash(hash: string) {
  if (!/^(?:0x)?[0-9a-f]{64}$/i.test(hash)) throw new Error("Unexpected transaction hash format.");
  console.log(`Transaction ${hash}`);
  console.log(`${QORE_EXPLORER}/tx/${hash}`);
}

async function settled(hash: Hex) {
  printHash(hash);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("Transaction reverted on chain.");
  console.log("Confirmed.");
}

async function wallet() {
  const account = privateKeyToAccount((await localAccount()).privateKey as Hex);
  return createWalletClient({
    account, chain: qorechainTestnet,
    transport: http(undefined, { fetchOptions: { headers: { "User-Agent": "MoveNotice CLI" } } }),
  });
}

function actionArgs(args: string[], positionals: number) {
  if (args.length < positionals || args.slice(0, positionals).some((arg) => arg.startsWith("--"))) {
    throw new Error("Missing command arguments. Run pnpm notice help.");
  }
  const options = new Map<string, string>();
  for (let i = positionals; i < args.length; i += 2) {
    const [option, value] = [args[i], args[i + 1]];
    if (!value || !["--valid", "--valid-until", "--nonce"].includes(option) || options.has(option)) {
      throw new Error("Invalid signing options. Run pnpm notice help.");
    }
    options.set(option, value);
  }
  if (options.has("--valid") && options.has("--valid-until")) throw new Error("Choose one expiry option.");
  return options;
}

async function prepare(kind: Action["kind"], account: Address, args: string[]) {
  const options = actionArgs(args, kind === "post" ? 2 : 0);
  const contract = await needContract("notice");
  const [nonce, { timestamp }] = await Promise.all([
    pub.readContract({ address: contract, abi: noticeAbi, functionName: "nonces", args: [account] }),
    pub.getBlock(),
  ]);
  const expectedNonce = options.get("--nonce");
  if (expectedNonce !== undefined && unsigned(expectedNonce, "nonce", 256) !== nonce) {
    throw new Error("The nonce changed. Refresh the message preview.");
  }
  const relative = options.get("--valid");
  const absolute = options.get("--valid-until");
  const validUntil = absolute === undefined
    ? timestamp + (relative === undefined ? PRACTICAL_EXPIRY : unsigned(relative, "validity"))
    : unsigned(absolute, "expiry");
  if (validUntil <= timestamp || validUntil >= 1n << 64n) throw new Error("Choose a future signature expiry.");
  const base = { account, contract, chainId: TESTNET_ID, nonce, validUntil };
  let action: Action = { ...base, kind: "cancel" };
  if (kind === "post") {
    const to = readTarget(args[0], account);
    const delay = unsigned(args[1], "delay");
    const [min, max] = await Promise.all([
      pub.readContract({ address: contract, abi: noticeAbi, functionName: "minDelay" }),
      pub.readContract({ address: contract, abi: noticeAbi, functionName: "MAX_DELAY" }),
    ]);
    if (delay < min || delay > max) throw new Error(`Choose a delay between ${min} and ${max} seconds.`);
    action = { ...base, kind, to, delay };
  }
  return { action, message: await onchainMessage(pub, action) };
}

async function sign(kind: Action["kind"], args: string[]) {
  const owner = await localAccount();
  await requireOwnedKey(owner);
  const { action, message } = await prepare(kind, readAddress(owner.evm), args);
  const signature = toHex(pqcSign(owner.pqc.secretKey, hexToBytes(message)));
  const file = `notices/${action.account.toLowerCase()}-${kind}-${action.nonce}.json`;
  const temp = `${file}.${randomUUID()}.tmp`;
  await mkdir("notices", { recursive: true });
  try {
    await writeFile(temp, JSON.stringify({
      kind, account: action.account,
      ...(action.kind === "post" ? { to: action.to, delay: Number(action.delay) } : {}),
      nonce: action.nonce.toString(), validUntil: action.validUntil.toString(),
      chainId: action.chainId, contract: action.contract, message, signature,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  console.log(`Signed notice saved to ${file}`);
  return file;
}

async function submit(file: string) {
  if (!file) throw new Error("Provide the signed notice JSON file.");
  const contract = await needContract("notice");
  const source = await readFile(file, "utf8");
  if (source.length > 24_000) throw new Error("Signed notice file is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new Error("Signed notice file is not valid JSON.");
  }
  const { action, signature } = readSignedNotice(raw, { contract });
  const [nonce, { timestamp }] = await Promise.all([
    pub.readContract({ address: contract, abi: noticeAbi, functionName: "nonces", args: [action.account] }),
    pub.getBlock(),
  ]);
  if (nonce !== action.nonce) throw new Error("Signed notice has a stale nonce.");
  if (action.validUntil < timestamp) throw new Error("Signed notice has expired.");
  const client = await wallet();
  const data = await simulateAction(pub, action, signature, client.account.address);
  await settled(await client.sendTransaction({ to: contract, data }));
}

async function attack(kind: Action["kind"], target?: string) {
  const owner = await localAccount();
  const account = readAddress(owner.evm);
  const contract = await needContract("notice");
  const args = kind === "post"
    ? [target ?? "", String(await pub.readContract({ address: contract, abi: noticeAbi, functionName: "minDelay" }))]
    : [];
  const { action, message } = await prepare(kind, account, args);
  const signature = toHex(pqcSign(generatePqcKeypair().secretKey, hexToBytes(message)));
  try {
    await simulateAction(pub, action, signature, account);
  } catch (error) {
    if (contractRevert(error)?.errorName !== "BadPqcSignature") throw error;
    console.log("BLOCKED: BadPqcSignature");
    return;
  }
  throw new Error("Unexpected result. The invalid signature passed simulation.");
}

async function pay(to: string, amount: string, send: boolean) {
  const recipient = readTarget(to ?? "");
  const value = readAmount(amount ?? "");
  const address = await needContract("pay");
  const client = send ? await wallet() : undefined;
  const sender = client?.account ?? readAddress((await localAccount()).evm);
  try {
    const { request } = await pub.simulateContract({
      account: sender,
      address, abi: payAbi, functionName: "pay", args: [recipient], value,
    });
    if (client) await settled(await client.writeContract(request));
    else console.log("OK");
  } catch (error) {
    const moved = movedRecipient(error);
    if (!moved) throw error;
    console.log(`REFUSED: AccountMoved(${moved.old} → ${moved.next})`);
    if (send) process.exitCode = 1;
  }
}

const help = `pnpm notice <command>
  status | register | recovery-code
  window:deploy | window:scoped
  sign-post <to> <delaySeconds> [--valid 3600]
  sign-cancel [--valid 3600]
  Signing also accepts --valid-until <unixSeconds> and --nonce <expectedNonce>.
  submit <file.json> | post <to> <delaySeconds> | cancel
  resolve <account> | finalize <account>
  pay <to> <amountQOR> | simulate-pay <to> <amountQOR>
  attack-post <to> | attack-cancel`;

const commands = {
  async help() { console.log(help); },
  async status() {
    const owner = await localAccount();
    console.log(`Account ${owner.evm} / ${owner.cosmos}`);
    const { key, keyMatches, window } = await accountStatus(owner);
    console.log(`PQC registered ${key.registered}; proven ${key.possessionProven === true}; local key matches ${keyMatches ?? "unknown"}`);
    console.log(window.found
      ? `Window ${window.live ? "live" : "closed"}; ${window.remainingBlocks} blocks; ${window.remainingTxs} transactions; ${window.remainingValue} uqor`
      : "Window absent.");
    const { notice } = await deployment();
    if (notice) console.log(`Notice nonce ${await pub.readContract({
      address: notice, abi: noticeAbi, functionName: "nonces", args: [readAddress(owner.evm)],
    })}`);
    else console.log("Notice nonce unavailable until deployment.");
  },
  async register() {
    const result = await register(await localAccount());
    if (result.txHash) printHash(result.txHash);
    else console.log("Matching proven key already registered.");
  },
  async "window:deploy"() {
    const result = await openWindow(await localAccount());
    printHash(result.hash);
    console.log(`Unscoped window: ${result.blocks} blocks, ${result.maxTxs} transactions, ${result.maxValue} uqor.`);
  },
  async "window:scoped"() {
    const deployed = await deployment(true);
    if (!deployed.notice || !deployed.pay) throw new Error("Deployment manifest is missing a contract address.");
    const result = await openWindow(await localAccount(), [deployed.notice, deployed.pay]);
    printHash(result.hash);
    console.log(`Scoped window: ${result.blocks} blocks, ${result.maxTxs} transactions, ${result.maxValue} uqor.`);
    console.log(`Allowed targets ${deployed.notice}, ${deployed.pay}`);
  },
  async "recovery-code"() {
    console.log("Store this recovery code offline, apart from your private key.");
    console.log(generatePqcRecoveryCode());
  },
  async "sign-post"(...args: string[]) { await sign("post", args); },
  async "sign-cancel"(...args: string[]) { await sign("cancel", args); },
  submit,
  async post(...args: string[]) { await submit(await sign("post", args)); },
  async cancel(...args: string[]) { await submit(await sign("cancel", args)); },
  async "attack-post"(to: string) { await attack("post", to); },
  async "attack-cancel"() { await attack("cancel"); },
  async pay(to: string, amount: string) { await pay(to, amount, true); },
  async "simulate-pay"(to: string, amount: string) { await pay(to, amount, false); },
  async finalize(input: string) {
    const client = await wallet();
    const address = await needContract("notice");
    const { request } = await pub.simulateContract({
      account: client.account, address, abi: noticeAbi, functionName: "finalize", args: [readAddress(input ?? "")],
    });
    await settled(await client.writeContract(request));
  },
  async resolve(input: string) {
    const account = readAddress(input ?? "");
    const address = await needContract("notice");
    const [[to, status, effectiveAt], [current, hops]] = await Promise.all([
      pub.readContract({ address, abi: noticeAbi, functionName: "resolve", args: [account] }),
      pub.readContract({ address, abi: noticeAbi, functionName: "resolveFinal", args: [account] }),
    ]);
    console.log(`${account} / ${nativeAddress(account)}: ${statuses[status]}`);
    if (status !== 0) console.log(`Target ${to}, effective ${new Date(Number(effectiveAt) * 1000).toISOString()}`);
    console.log(`Final path: ${current} (${hops} hops)`);
  },
} satisfies Record<string, (...args: string[]) => Promise<void>>;

async function main() {
  if ((process.env.QORE_NETWORK?.trim() || "testnet") !== "testnet") throw new Error("MoveNotice is testnet only.");
  const [name = "status", ...args] = process.argv.slice(2);
  if (!Object.hasOwn(commands, name)) throw new Error("Unknown command. Run pnpm notice help.");
  const run: (...args: string[]) => Promise<void> = commands[name as keyof typeof commands];
  await run(...args);
}

main().catch((error: unknown) => {
  const revert = contractRevert(error);
  if (revert) logError(`REFUSED: ${revert.errorName}`);
  else if (error instanceof BaseError && /evm window|authori[sz]ation window|invalid parameters|codespace.?[:=]?.?pqc.*\b(26|27|28)\b/i.test(error.message)) {
    logError("EVM admission failed. Check pnpm notice status and reopen the correct window.");
  } else if (error instanceof BaseError) {
    logError("Testnet RPC or transaction request failed. Check status and the configured contract addresses.");
  } else {
    logError(error instanceof Error && error.constructor === Error ? error.message : "Command failed. Check account or testnet status.");
  }
  process.exitCode = 1;
});
