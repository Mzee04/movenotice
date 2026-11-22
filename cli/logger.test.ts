import { afterEach, describe, expect, it, vi } from "vitest";
import { redact, reportCommandError } from "./logger";

describe("CLI redaction", () => {
  it("removes prefixed and bare private-key shapes", () => {
    expect(redact(`key=0x${"a".repeat(64)} or ${"B".repeat(64)}`)).toBe("key=[redacted key] or [redacted key]");
  });

  it.each([12, 24])("removes a %i-word phrase", (count) => {
    const words = Array.from({ length: count }, () => "sample").join(" ");
    expect(redact(`credentials: ${words}`)).toBe("credentials: [redacted phrase]");
  });

  it("removes recovery codes and exact credential values", () => {
    const code = ["QRC1", "placeholder", "encoded"].join("-");
    expect(redact(`value=${code} password=anExample`, ["anExample"])).toBe(
      "value=[redacted recovery code] password=[redacted]",
    );
  });

  it("preserves public addresses and a safe error label", () => {
    const publicAddress = "0x" + "1".repeat(40);
    expect(redact(`BadPqcSignature for ${publicAddress}`)).toBe(`BadPqcSignature for ${publicAddress}`);
  });
});

describe("CLI error diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports the PQC rejection, window hint, and public transaction hash", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const transactionHash = "0x" + "ab".repeat(32);
    reportCommandError({ code: 27, codespace: "pqc", transactionHash, rawLog: "private node response" });
    expect(stderr.mock.calls).toEqual([
      ["Chain refused the transaction: codespace pqc, code 27."],
      [expect.stringContaining("reopen the correct window")],
    ]);
    expect(stdout.mock.calls).toEqual([
      [`Transaction ${transactionHash}`],
      [`https://explore.qore.network/tx/${transactionHash}`],
    ]);
  });

  it("keeps key-shaped values and a 12-word phrase out of the command error output", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const key = "0x" + "cd".repeat(32);
    const phrase = Array.from({ length: 12 }, () => "sample").join(" ");
    reportCommandError(new Error(`key=${key}, phrase: ${phrase}`));
    expect(stderr.mock.calls).toEqual([["key=[redacted key], phrase: [redacted phrase]"]]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("reports the name of an SDK error and suppresses its message and malformed hash", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    class PqcKeyMismatchError extends Error {
      override name = "PqcKeyMismatchError";
      txHash = "ab".repeat(32) + "\n";
    }
    reportCommandError(new PqcKeyMismatchError("response from SDK"));
    expect(stderr.mock.calls).toEqual([["PqcKeyMismatchError. Check account or testnet status."]]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("accepts the txHash field used by QoreTxError", () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const txHash = "ef".repeat(32);
    reportCommandError({ code: 2, codespace: "bank", txHash });
    expect(stderr.mock.calls).toEqual([["Chain refused the transaction: codespace bank, code 2."]]);
    expect(stdout).toHaveBeenCalledWith(`Transaction ${txHash}`);
  });
});
