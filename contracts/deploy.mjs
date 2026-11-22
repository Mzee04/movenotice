import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { parseAccountIndex } from "../cli/account-index.mjs";

const staged = "deployments/testnet.local.json";
const manifest = "deployments/testnet.json";
const history = "contracts/broadcast/Deploy.s.sol/9800/run-latest.json";

async function run() {
  if ((process.env.QORE_NETWORK?.trim() || "testnet") !== "testnet") {
    console.error("MoveNotice deploys to QoreChain Testnet.");
    return false;
  }
  let index;
  try {
    index = parseAccountIndex(process.env.QORE_ACCOUNT_INDEX);
  } catch (error) {
    console.error(error.message);
    return false;
  }
  const mnemonic = process.env.QORE_MNEMONIC?.trim();
  const key = mnemonic
    ? (await deriveUnifiedAccount(mnemonic, index)).privateKey
    : process.env.PRIVATE_KEY?.trim();
  if (!key || !/^0x[\da-f]{64}$/i.test(key) || /^0x0+$/.test(key)) {
    console.error("Set QORE_MNEMONIC or a valid PRIVATE_KEY for the funded testnet account.");
    return false;
  }

  rmSync(staged, { force: true });
  const result = spawnSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", "qorechain_testnet", "--broadcast", "--slow"], {
    cwd: "contracts",
    env: {
      ...process.env, PRIVATE_KEY: key, MOVENOTICE_DEPLOYMENT_OUTPUT: "../deployments/testnet.local.json",
    },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  // Forge traces may contain environment inputs, so emit only verified public receipt data.
  if (result.status !== 0) {
    console.error(/window|invalid parameters/i.test(result.stderr ?? "")
      ? "Deployment was refused. Check the funded account and its unscoped deployment window."
      : "Forge did not confirm both deployments. Check testnet status and the local broadcast receipts before retrying.");
    return false;
  }

  const deployment = JSON.parse(readFileSync(staged, "utf8"));
  const broadcast = JSON.parse(readFileSync(history, "utf8"));
  const receipt = (address) => broadcast.receipts.find((item) =>
    item.status === "0x1" && item.contractAddress?.toLowerCase() === address.toLowerCase(),
  );
  const notice = receipt(deployment.moveNotice);
  const pay = receipt(deployment.guardedPay);
  if (deployment.chainId !== 9800 || !notice || !pay) return false;
  const address = /^0x[\da-f]{40}$/i;
  const hash = /^0x[\da-f]{64}$/i;
  if (![deployment.moveNotice, deployment.guardedPay, deployment.deployer].every((value) => address.test(value))
    || ![notice.transactionHash, pay.transactionHash].every((value) => hash.test(value))) return false;

  const publicRecord = {
    chainId: 9800, deployer: deployment.deployer,
    moveNotice: deployment.moveNotice, guardedPay: deployment.guardedPay,
    block: BigInt(notice.blockNumber).toString(),
    moveNoticeTx: notice.transactionHash, guardedPayTx: pay.transactionHash,
  };
  writeFileSync(staged, JSON.stringify(publicRecord, null, 2) + "\n");
  renameSync(staged, manifest);
  console.log(`MoveNotice ${publicRecord.moveNotice} (${publicRecord.moveNoticeTx})`);
  console.log(`GuardedPay ${publicRecord.guardedPay} (${publicRecord.guardedPayTx})`);
  console.log("Saved deployments/testnet.json.");
  return true;
}

run().then((confirmed) => {
  if (!confirmed) process.exitCode = 1;
}).catch(() => {
  console.error("Deployment could not be verified. Check the testnet account and local broadcast receipts.");
  process.exitCode = 1;
});
