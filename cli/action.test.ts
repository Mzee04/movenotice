import { expect, test } from "vitest";
import { hexToBytes, type Address } from "viem";
import { mldsa } from "@qorechain/pqc";
import { pqcSign } from "@qorechain/sdk";
import { buildMessage, type Action } from "../shared/messages";
import golden from "../shared/golden.json";

test("real ML-DSA-87 signs and verifies the golden post bytes", () => {
  const action: Action = {
    kind: "post", account: golden.account as Address, contract: golden.contract as Address,
    to: golden.to as Address, chainId: golden.chainId, delay: BigInt(golden.delay),
    nonce: BigInt(golden.nonce), validUntil: BigInt(golden.validUntil),
  };
  const encoded = buildMessage(action);
  expect(encoded).toBe(golden.post);
  const message = hexToBytes(encoded);
  const key = mldsa.keygen(new Uint8Array(32).fill(42));
  const signature = mldsa.sign(key.secretKey, message);
  expect(key.publicKey).toHaveLength(2592);
  expect(signature).toHaveLength(4627);
  expect(mldsa.verify(key.publicKey, message, signature)).toBe(true);
  expect(mldsa.verify(key.publicKey, message, pqcSign(key.secretKey, message))).toBe(true);
  signature[0] ^= 1;
  expect(mldsa.verify(key.publicKey, message, signature)).toBe(false);
});
