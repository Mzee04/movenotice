import { describe, expect, it } from "vitest";
import { redact } from "./logger";

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
