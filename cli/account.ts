import { StargateClient } from "@cosmjs/stargate";
import { evmWindowStatus } from "@qorechain/evm";
import {
  EthNativeSigner, TxClient, deriveUnifiedAccount, ensurePqcRegistered, fetchPqcStatus, getNetwork,
  isRegisteredPqcKey, isValidRecoveryCode, openEvmWindowMsg, signProofOfPossession,
  unifiedAccountFromSeed, type UnifiedAccount,
} from "@qorechain/sdk";
import { hexToBytes, type Address, type Hex } from "viem";
import { QORE_REST, QORE_RPC } from "../shared/messages";

const CHAIN = "qorechain-diana";
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };
type Messages = Parameters<EthNativeSigner["sign"]>[0]["messages"];

export async function localAccount(): Promise<UnifiedAccount> {
  const mnemonic = process.env.QORE_MNEMONIC?.trim();
  const key = process.env.PRIVATE_KEY?.trim();
  const recoveryCode = process.env.QORE_PQC_RECOVERY_CODE?.trim();
  if (mnemonic) {
    try {
      return await deriveUnifiedAccount(mnemonic, 0);
    } catch {
      throw new Error("QORE_MNEMONIC could not be used to derive a coin-60 account.");
    }
  }
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || /^0x0+$/.test(key)
    || !recoveryCode || !isValidRecoveryCode(recoveryCode)) {
    throw new Error("Set QORE_MNEMONIC or a valid PRIVATE_KEY and QORE_PQC_RECOVERY_CODE.");
  }
  try {
    return unifiedAccountFromSeed(hexToBytes(key as Hex), { recoveryCode });
  } catch {
    throw new Error("The testnet credentials could not be used to derive an account.");
  }
}

export async function accountStatus(account: UnifiedAccount) {
  const [key, window] = await Promise.all([
    fetchPqcStatus({ rest: QORE_REST, address: account.cosmos }),
    evmWindowStatus({ rest: QORE_REST, address: account.cosmos }),
  ]);
  return { key, keyMatches: isRegisteredPqcKey(key, account.pqc.publicKey), window };
}

export async function requireOwnedKey(account: UnifiedAccount) {
  const key = await fetchPqcStatus({ rest: QORE_REST, address: account.cosmos });
  if (!key.registered) throw new Error("Register the account first with pnpm notice register.");
  if (!key.possessionProven || key.algorithmId !== 1 || isRegisteredPqcKey(key, account.pqc.publicKey) !== true) {
    throw new Error("The account needs a matching, proven ML-DSA-87 key.");
  }
}

async function accountSequence(address: string) {
  const res = await fetch(`${QORE_REST}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error("Fund this testnet account before opening a window or registering.");
  if (!res.ok) throw new Error(`Account query failed with HTTP ${res.status}.`);
  type Base = { account_number?: string; sequence?: string };
  const body = await res.json() as { account?: Base & { base_account?: Base } };
  const base = body.account?.base_account ?? body.account;
  if (!base?.account_number || !base?.sequence) throw new Error("Account query returned no sequence.");
  return { accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence) };
}

export async function register(account: UnifiedAccount) {
  const signer = new EthNativeSigner(account, { signMode: "classical", rest: QORE_REST });
  const unused = async (): Promise<never> => { throw new Error("Registration requires a fixed fee and commit mode."); };
  // TxClient handles idempotency and response parsing. EthNativeSigner encodes
  // coin-60 signatures for the native lane, including bootstrap registration.
  const tx = new TxClient({
    senderAddress: account.cosmos,
    signingClient: {
      simulate: unused,
      signAndBroadcastSync: unused,
      async signAndBroadcast(_, messages, fee, memo) {
        const sequence = await accountSequence(account.cosmos);
        const { txRawBytes } = signer.sign({ ...sequence, chainId: CHAIN, messages, fee, memo });
        const client = await StargateClient.connect(QORE_RPC);
        try {
          return await client.broadcastTx(txRawBytes);
        } finally {
          client.disconnect();
        }
      },
    },
  });
  const status = await fetchPqcStatus({ rest: QORE_REST, address: account.cosmos });
  const result = await ensurePqcRegistered(tx, {
    rest: QORE_REST, chainId: CHAIN, status, fee: FEE, pqcKeypair: account.pqc,
    ecdsaPubkey: hexToBytes(account.publicKey as Hex),
    proofOfPossession: status.registered ? undefined : signProofOfPossession({
      chainId: CHAIN, account: account.cosmos, keypair: account.pqc,
    }),
  });
  if (result.alreadyRegistered) await requireOwnedKey(account);
  return result;
}

async function broadcastHybrid(account: UnifiedAccount, messages: Messages) {
  const sequence = await accountSequence(account.cosmos);
  const signer = new EthNativeSigner(account, { signMode: "hybrid", rest: QORE_REST });
  const client = await StargateClient.connect(QORE_RPC);
  try {
    return await signer.signAndBroadcast(client, { ...sequence, chainId: CHAIN, fee: FEE, messages });
  } finally {
    client.disconnect();
  }
}

export function windowPlan(allowedTargets?: readonly [Address, Address]) {
  return {
    blocks: allowedTargets ? 1200n : 600n,
    maxTxs: allowedTargets ? 8n : 3n,
    maxValue: 2_000_000n,
    ...(allowedTargets ? { allowedTargets: [...allowedTargets] } : {}),
  };
}

export async function openWindow(account: UnifiedAccount, allowedTargets?: readonly [Address, Address]) {
  if (getNetwork("testnet").chainId !== CHAIN) throw new Error("Unexpected SDK testnet chain ID.");
  await requireOwnedKey(account);
  const plan = windowPlan(allowedTargets);
  const message = openEvmWindowMsg({ sender: account.cosmos, ...plan });
  const tx = await broadcastHybrid(account, [message]);
  return { ...plan, hash: tx.transactionHash };
}
