import { BaseError } from "viem";
import { contractRevert } from "../shared/errors";
import { QORE_EXPLORER } from "../shared/messages";

const keyPattern = /(?<![\da-f])(?:0x)?[\da-f]{64}(?![\da-f])/gi;
const recoveryPattern = /QRC1-[\w-]*/gi;
const phrasePattern = /\b[a-z]{3,}(?:[ \t\r\n]+[a-z]{3,}){11,}\b/gi;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function redact(input: string, known: readonly (string | undefined)[] = []): string {
  let safe = input;
  for (const value of known) {
    if (value?.trim()) safe = safe.replaceAll(value.trim(), "[redacted]");
  }
  return safe.replace(keyPattern, "[redacted key]")
    .replace(recoveryPattern, "[redacted recovery code]")
    .replace(phrasePattern, "[redacted phrase]").replace(controls, "");
}

export function logError(input: string): void {
  console.error(redact(input, [process.env.PRIVATE_KEY, process.env.QORE_MNEMONIC, process.env.QORE_PQC_RECOVERY_CODE]));
}

const hashPattern = /^(?:0x)?[0-9a-f]{64}$/i;
const windowHint = "EVM admission failed. Check pnpm notice status and reopen the correct window.";

function isHash(value: unknown): value is string {
  return typeof value === "string" && hashPattern.test(value) && value === value.trim();
}

export function printHash(hash: string): void {
  if (!isHash(hash)) throw new Error("Unexpected transaction hash format.");
  console.log(`Transaction ${hash}`);
  console.log(`${QORE_EXPLORER}/tx/${hash}`);
}

function reportChainError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, codespace, transactionHash, txHash } = error as {
    code?: unknown; codespace?: unknown; transactionHash?: unknown; txHash?: unknown;
  };
  const hash = isHash(transactionHash) ? transactionHash : isHash(txHash) ? txHash : undefined;
  const lane = typeof codespace === "string" && /^[a-z][a-z0-9_.-]{0,31}$/i.test(codespace) && codespace === codespace.trim()
    ? codespace : "unknown";
  const hasCode = typeof code === "number" && Number.isSafeInteger(code)
    && (typeof codespace === "string" || hash !== undefined);

  if (hasCode) {
    logError(`Chain refused the transaction: codespace ${lane}, code ${code}.`);
    if (lane.toLowerCase() === "pqc" && (code === 26 || code === 27 || code === 28)) logError(windowHint);
  }
  if (hash) printHash(hash);
  return hasCode;
}

export function reportCommandError(error: unknown): void {
  if (reportChainError(error)) return;
  const revert = contractRevert(error);
  if (revert) {
    logError(`REFUSED: ${revert.errorName}`);
  } else if (error instanceof BaseError) {
    if (/evm window|authori[sz]ation window|invalid parameters|codespace.?[:=]?.?pqc.*\b(26|27|28)\b/i.test(error.message)) {
      logError(windowHint);
    } else {
      logError("Testnet RPC or transaction request failed. Check status and the configured contract addresses.");
    }
  } else if (error instanceof Error && error.constructor === Error) {
    logError(error.message);
  } else if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) {
    logError(`${error.name}. Check account or testnet status.`);
  } else {
    logError("Command failed. Check account or testnet status.");
  }
}
