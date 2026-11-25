import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, isAddressEqual, type Address, type Hex } from "viem";
import { TESTNET_ID } from "../../../shared/messages";
import { client } from "./chain";

type PendingPayment = { hash: Hex; recipient: Address; value: string };
type SettledPayment = { hash: Hex; status: "success" | "reverted" };

const keyPrefix = `movenotice:pending-payments:${TESTNET_ID}:`;

function pendingKeys(senderKey?: string) {
  if (senderKey) return [senderKey];
  // A reload can leave the wallet disconnected. The CLI fallback has no selected sender.
  const storage = window.localStorage;
  return Object.keys(storage).filter((key) => key.startsWith(keyPrefix));
}

export function repeatsPayment(payments: PendingPayment[], recipient: Address, value: bigint) {
  return payments.some((payment) => isAddressEqual(payment.recipient, recipient) && payment.value === value.toString());
}

function readPending(key: string): PendingPayment[] {
  const payments: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(payments) || !payments.every((payment: unknown) => {
    if (!payment || typeof payment !== "object") return false;
    const { hash, recipient, value } = payment as Partial<PendingPayment>;
    return typeof hash === "string" && /^0x[\da-f]{64}$/i.test(hash)
      && typeof recipient === "string" && isAddress(recipient)
      && typeof value === "string" && /^[1-9]\d*$/.test(value);
  })) {
    throw new Error("Invalid pending payment history.");
  }
  return payments;
}

function writePending(key: string, payments: PendingPayment[]) {
  if (payments.length) window.localStorage.setItem(key, JSON.stringify(payments));
  else window.localStorage.removeItem(key);
}

async function checkReceipt({ hash }: PendingPayment): Promise<SettledPayment | undefined> {
  try {
    const { status } = await client.getTransactionReceipt({ hash });
    if (status === "success" || status === "reverted") return { hash, status };
  } catch {
    // A missing receipt or an RPC error leaves the payment unresolved.
  }
}

export function usePendingPayments(sender?: Address) {
  const senderKey = sender && `${keyPrefix}${sender.toLowerCase()}`;
  const [pending, setPending] = useState<PendingPayment[]>([]);
  const [settled, setSettled] = useState<SettledPayment>();
  const [storageError, setStorageError] = useState(false);
  const unsaved = useRef<PendingPayment | undefined>(undefined);

  const reconcile = useCallback(async () => {
    try {
      if (senderKey && unsaved.current) {
        writePending(senderKey, [...readPending(senderKey), unsaved.current]);
        unsaved.current = undefined;
      }
      const batches = pendingKeys(senderKey).map((key) => ({ key, payments: readPending(key) }));
      setPending(batches.flatMap(({ payments }) => payments));
      const receipts = await Promise.all(batches.map(async ({ key, payments }) => ({
        key,
        completed: (await Promise.all(payments.map(checkReceipt))).filter((receipt) => receipt !== undefined),
      })));
      const remaining: PendingPayment[] = [];
      for (const { key, completed } of receipts) {
        // Keep any payments added while the RPC calls were in flight.
        const latest = readPending(key);
        const unresolved = latest.filter((payment) => !completed.some((receipt) => receipt.hash === payment.hash));
        if (unresolved.length < latest.length) {
          writePending(key, unresolved);
          setSettled(completed.filter((receipt) => latest.some((payment) => payment.hash === receipt.hash)).at(-1));
        }
        remaining.push(...unresolved);
      }
      if (unsaved.current) return undefined;
      setPending(remaining);
      setStorageError(false);
      return remaining;
    } catch {
      setStorageError(true);
      return undefined;
    }
  }, [senderKey]);

  useEffect(() => {
    void reconcile();
    const interval = window.setInterval(() => { void reconcile(); }, 6_000);
    function sync(event: StorageEvent) {
      if (event.key === null || (senderKey ? event.key === senderKey : event.key.startsWith(keyPrefix))) void reconcile();
    }
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", sync);
    };
  }, [senderKey, reconcile]);

  function record(hash: Hex, recipient: Address, value: bigint) {
    const payment = { hash, recipient, value: value.toString() };
    unsaved.current = payment;
    setPending((payments) => [...payments, payment]);
    setSettled(undefined);
    void reconcile();
  }

  return { pending, settled, storageError, reconcile, record };
}
