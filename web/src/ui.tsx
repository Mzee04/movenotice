import { useEffect, useState, type ReactNode } from "react";
import { type Hex } from "viem";
import { statuses } from "../../shared/abi";
import { QORE_EXPLORER } from "../../shared/messages";

export function utc(timestamp: bigint) {
  const date = new Date(Number(timestamp) * 1000);
  return Number.isFinite(date.getTime())
    ? date.toISOString().replace("T", " ").replace(".000Z", " UTC")
    : `${timestamp} Unix seconds`;
}

export function remaining(seconds: bigint) {
  const amount = seconds > 0n ? seconds : 0n;
  const days = amount / 86_400n;
  const hours = amount / 3600n % 24n;
  const minutes = amount / 60n % 60n;
  const secs = amount % 60n;
  if (days) return `${days} d ${hours} hr left`;
  if (hours) return `${hours} hr ${minutes} min left`;
  return minutes ? `${minutes} min ${String(secs).padStart(2, "0")} s left` : `${secs} s left`;
}

export function useChainClock(timestamp?: bigint) {
  const [elapsed, setElapsed] = useState(0n);
  useEffect(() => {
    setElapsed(0n);
    if (timestamp === undefined) return;
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed(BigInt(Math.floor((performance.now() - start) / 1000))), 250);
    return () => window.clearInterval(timer);
  }, [timestamp]);
  return (timestamp ?? 0n) + elapsed;
}

export function StatusPill({ status }: { status: number }) {
  const label = statuses[status] ?? "UNKNOWN";
  return <span className={`status-pill status-${label.toLowerCase()}`}>{label}</span>;
}

export function Feedback({ tone = "info", children }: {
  tone?: "info" | "good" | "warning" | "danger"; children: ReactNode;
}) {
  return <div className={`feedback ${tone}`} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}

export function CopyCommand({ command, label = "Copy CLI command" }: { command: string; label?: string }) {
  const [copied, setCopied] = useState<"yes" | "no">();
  useEffect(() => setCopied(undefined), [command]);
  return (
    <div className="command">
      <code>{command}</code>
      <button type="button" className="button secondary small" onClick={async () => {
        try { await navigator.clipboard.writeText(command); setCopied("yes"); }
        catch { setCopied("no"); }
      }}>{label}</button>
      {copied && <span className="copy-status" role="status">{copied === "yes" ? "Copied." : "Select the command to copy it."}</span>}
    </div>
  );
}

export function TxLink({ hash, children = "View transaction" }: { hash: Hex; children?: ReactNode }) {
  return <a href={`${QORE_EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">{children}</a>;
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="section-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}
