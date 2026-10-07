import type { Metadata } from "next";
import { explorerUrl } from "@/config/solana";
import type { Cluster } from "@/config/solana";
import { formatSol, shortAddress } from "@/lib/format";
import { listLedger } from "@/server/operator";
import { scheduleWork } from "@/server/views";

export const dynamic = "force-dynamic";
const KIND: Record<string, string> = { "launch-in": "First buy received", withdraw: "Fee share withdrawn by a launcher", sol: "Transfer", prize: "Weekly prize", token: "First-buy tokens forwarded", claim: "Creator fees collected", buy: "$VOLUMEPAD bought", burn: "$VOLUMEPAD burned" };
export const metadata: Metadata = { title: "Ledger" };

export default function LedgerPage() {
  scheduleWork();
  const rows = listLedger(undefined, 300);
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-8 sm:py-16">
      <p className="label">open books</p>
      <h1 className="display-xl mt-4 text-[clamp(52px,8vw,104px)]">Ledger</h1>
      <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">Every transfer into and out of the launch wallet: first buys, creator fees collected from pump.fun, weekly prizes, launcher withdrawals, forwarded tokens, and every $VOLUMEPAD buy and burn, each with its transaction on Solscan.</p>
      <div className="card mt-10 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-muted" data-testid="ledger-empty">No transfers yet. The first one appears here with its Solscan link.</p>
        ) : (
          <table className="table min-w-[720px]" data-testid="ledger-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>To</th>
                <th>Amount</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cluster = row.cluster as Cluster;
                return (
                  <tr key={row.id} data-testid="ledger-row" data-kind={row.kind}>
                    <td className="whitespace-nowrap">{new Date(row.at).toISOString().replace("T", " ").slice(0, 16)} UTC</td>
                    <td>
                      {KIND[row.kind] ?? row.kind}
                      {row.note && <span className="block text-[12px] text-muted-foreground">{row.note}</span>}
                    </td>
                    <td className="mono">
                      {row.to ? (
                        <a className="link" href={explorerUrl("account", row.to, cluster)} target="_blank" rel="noreferrer">{shortAddress(row.to)}</a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono">{row.kind === "token" || row.kind === "burn" ? row.amount : `${formatSol(BigInt(row.amount))} SOL`}</td>
                    <td className="mono">
                      <a className="link" href={explorerUrl("tx", row.sig, cluster)} target="_blank" rel="noreferrer" data-testid="ledger-sig">
                        {shortAddress(row.sig)}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
