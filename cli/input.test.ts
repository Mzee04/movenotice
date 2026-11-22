import { describe, expect, it } from "vitest";
import { nativeAddress, readTarget } from "../shared/addresses";
import { readPaymentRecipient } from "../shared/payment";
import { parseAccountIndex } from "./account-index.mjs";
import { signatureExpiry } from "./expiry";

describe("Coin-60 account index", () => {
  it("defaults to zero and accepts the full non-hardened index range", () => {
    expect(parseAccountIndex(undefined)).toBe(0);
    expect(parseAccountIndex("0")).toBe(0);
    expect(parseAccountIndex("17")).toBe(17);
    expect(parseAccountIndex("2147483647")).toBe(2_147_483_647);
  });

  it.each(["-1", "0.5", "2147483648", "1e3", "", "3\n"])("rejects an invalid index %j", (input) => {
    expect(() => parseAccountIndex(input)).toThrow("QORE_ACCOUNT_INDEX must be an integer from 0 to 2147483647.");
  });
});

describe("Signature expiry", () => {
  const timestamp = 1_799_999_500n;
  const maximum = timestamp + 86_400n;

  it("defaults to one hour and allows the 24-hour boundary for both options", () => {
    expect(signatureExpiry(timestamp)).toBe(timestamp + 3600n);
    expect(signatureExpiry(timestamp, "86400")).toBe(maximum);
    expect(signatureExpiry(timestamp, undefined, String(maximum))).toBe(maximum);
  });

  it("rejects a relative lifetime above 24 hours", () => {
    expect(() => signatureExpiry(timestamp, "86401")).toThrow("Choose an expiry within 24 hours.");
  });

  it("rejects an absolute expiry more than 24 hours after the block time", () => {
    expect(() => signatureExpiry(timestamp, undefined, String(maximum + 1n)))
      .toThrow("Choose an expiry within 24 hours.");
  });
});

describe("CLI payment recipient", () => {
  const lastSystem = "0x000000000000000000000000000000000000ffff";
  const firstNormal = "0x0000000000000000000000000000000000010000";
  const error = "Choose a normal account address; funds sent to system addresses cannot be recovered.";

  it("rejects the whole system range, including zero and the upper boundary in both address formats", () => {
    expect(() => readPaymentRecipient("0x0000000000000000000000000000000000000000")).toThrow(error);
    expect(() => readPaymentRecipient(lastSystem)).toThrow(error);
    expect(() => readPaymentRecipient(nativeAddress(lastSystem))).toThrow(error);
  });

  it("accepts the first normal recipient and still accepts a system address as a move target", () => {
    expect(readPaymentRecipient(nativeAddress(firstNormal))).toBe(firstNormal);
    expect(readTarget(lastSystem).toLowerCase()).toBe(lastSystem);
  });
});
