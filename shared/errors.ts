import { BaseError, ContractFunctionRevertedError, type Address } from "viem";

export function contractRevert(error: unknown) {
  if (!(error instanceof BaseError)) return;
  const cause = error.walk((item) => item instanceof ContractFunctionRevertedError);
  if (cause instanceof ContractFunctionRevertedError) return cause.data;
}

export function movedRecipient(error: unknown) {
  const revert = contractRevert(error);
  if (revert?.errorName !== "AccountMoved" || revert.args?.length !== 2) return;
  return { old: revert.args[0] as Address, next: revert.args[1] as Address };
}
