import { parseEther } from "viem";

export function readAmount(input: string): bigint {
  const value = input.trim();
  if (!/^(0|[1-9][0-9]{0,59})(\.[0-9]{1,18})?$/.test(value)) {
    throw new Error("Enter a positive amount with up to 18 decimal places.");
  }
  const amount = parseEther(value);
  if (amount <= 0n || amount >= 1n << 256n) throw new Error("The payment amount is out of range.");
  return amount;
}
