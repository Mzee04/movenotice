import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { noticeAbi } from "./abi";
import { buildMessage, type Action } from "./messages";
import { messageCall, noticeCall } from "./notices";

export async function onchainMessage(client: PublicClient, action: Action): Promise<Hex> {
  const call = messageCall(action);
  const target = { address: action.contract, abi: noticeAbi };
  // Narrow each ABI method together with its argument tuple for viem.
  const message = call.functionName === "postMessage"
    ? await client.readContract({ ...target, ...call })
    : await client.readContract({ ...target, ...call });
  if (message !== buildMessage(action)) throw new Error("Contract message layout differs from MoveNotice v1.");
  return message;
}

export async function simulateAction(client: PublicClient, action: Action, signature: Hex, sender: Address) {
  const call = noticeCall(action, signature);
  const target = { address: action.contract, abi: noticeAbi, account: sender };
  if (call.functionName === "postMove") await client.simulateContract({ ...target, ...call });
  else await client.simulateContract({ ...target, ...call });
  return encodeFunctionData({ abi: noticeAbi, ...call });
}
