import { expect, test } from "vitest";
import { openEvmWindowMsg } from "@qorechain/sdk";
import { nativeAddress } from "../shared/addresses";
import { windowPlan } from "./account";

const board = "0x3333333333333333333333333333333333333333";
const guard = "0x4444444444444444444444444444444444444444";

test("the deploy window carries no target allowlist", () => {
  expect(windowPlan()).toEqual({ blocks: 600n, maxTxs: 3n, maxValue: 2_000_000n });
});

test("the scoped window builder accepts only the two deployment targets", () => {
  const plan = windowPlan([board, guard]);
  expect(plan).toEqual({ blocks: 1200n, maxTxs: 8n, maxValue: 2_000_000n, allowedTargets: [board, guard] });
  const message = openEvmWindowMsg({ ...plan, sender: nativeAddress(board) });
  expect(message.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
  expect(message.value.allowedTargets).toHaveLength(2);
});
