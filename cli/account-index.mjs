// @ts-check

/** @param {string | undefined} input */
export function parseAccountIndex(input) {
  if (input === undefined) return 0;
  const index = Number(input);
  if (input.length === 0 || /\D/.test(input) || index > 2_147_483_647) {
    throw new Error("QORE_ACCOUNT_INDEX must be an integer from 0 to 2147483647.");
  }
  return index;
}
