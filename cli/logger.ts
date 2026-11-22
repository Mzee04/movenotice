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
