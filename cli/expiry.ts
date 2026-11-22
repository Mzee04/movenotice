import { PRACTICAL_EXPIRY, unsigned } from "../shared/messages";

const MAX_SIGNATURE_LIFETIME = 86_400n;

export function signatureExpiry(timestamp: bigint, relative?: string, absolute?: string): bigint {
  const validUntil = absolute === undefined
    ? timestamp + (relative === undefined ? PRACTICAL_EXPIRY : unsigned(relative, "validity", 256))
    : unsigned(absolute, "expiry", 256);
  if (validUntil - timestamp > MAX_SIGNATURE_LIFETIME) throw new Error("Choose an expiry within 24 hours.");
  if (validUntil <= timestamp || validUntil >= 1n << 64n) throw new Error("Choose a future signature expiry.");
  return validUntil;
}
