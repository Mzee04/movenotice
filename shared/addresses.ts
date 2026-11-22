import { qoreAddresses } from "@qorechain/sdk";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";

export function readAddress(input: string): Address {
  const value = input.trim();
  if (value.startsWith("qor1")) {
    try {
      const decoded = qoreAddresses({ cosmos: value });
      if (decoded.cosmos !== value) throw new Error();
      return getAddress(decoded.evm);
    } catch {
      throw new Error("Enter a valid qor1 or 0x address.");
    }
  }
  if (!isAddress(value, { strict: true })) throw new Error("Enter a valid qor1 or checksummed 0x address.");
  return getAddress(value);
}

export function readTarget(input: string, account?: Address): Address {
  const target = readAddress(input);
  if (target === zeroAddress) throw new Error("Choose a non-zero address.");
  if (account && target === getAddress(account)) throw new Error("Choose an address different from your account.");
  return target;
}

export function nativeAddress(account: Address): string {
  return qoreAddresses({ evm: account }).cosmos;
}
