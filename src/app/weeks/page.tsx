import type { Metadata } from "next";
import Link from "next/link";
import { explorerUrl } from "@/config/solana";
import { shortAddress } from "@/lib/format";
import { sol } from "@/lib/show";
import { pastWeeks, scheduleWork } from "@/server/views";

export const metadata: Metadata = { title: "Past weeks" };
export const dynamic = "force-dynamic";

const day = (ms: number) => new Date(ms).toUTCString().slice(5, 16);

export default function WeeksPage() {
  scheduleWork();
  const weeks = pastWeeks(52);
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-8 sm:py-16">
      <p className="label">frozen standings</p>
      <h1 className="display-xl mt-4 text-[clamp(52px,8vw,104px)]">Past weeks</h1>
      <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">
        Each finished week as it was frozen at the close: final counted volume, traders, the pot, each prize and its transfer. When fewer coins qualify than there are prizes, the unpaid share rolls into the next week.
      </p>

      {weeks.length === 0 ? (
        <div className="mt-10 rounded-[28px] border border-dashed border-border bg-panel px-6 py-16 text-center" data-testid="weeks-empty">
          <p className="display-lg text-[32px]">No finished weeks yet</p>
          <p className="mt-2 text-[15px] text-muted-foreground">The first week freezes when it closes, Sunday 23:59 UTC.</p>
          <Link href="/leaderboard" className="btn-line mt-6 inline-flex h-11 items-center rounded-full px-6 text-[14px]">
            View the live leaderboard
          </Link>
        </div>
      ) : (
        <div className="mt-10 grid gap-6" data-testid="weeks">
          {weeks.map(({ w, rows, prizes }) => (
            <article key={w.week} className="rounded-[28px] border border-border bg-panel p-5 sm:p-7" data-testid="week">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="mono text-[12px] text-muted-foreground">week {w.week}</div>
                  <h2 className="display-lg mt-1 text-[32px]">
                    {day(w.startAt)} → {day(w.endAt - 60_000)}
                  </h2>
                </div>
                <dl className="mono grid grid-cols-3 gap-5 text-[12.5px]">
                  <div>
                    <dt className="text-muted-foreground">pot</dt>
                    <dd className="num text-[24px]" data-testid="week-pot">
                      {sol(w.pot, 4)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">rolled in</dt>
                    <dd className="mt-1.5">{sol(w.rolloverIn, 4)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">rolled on</dt>
                    <dd className="mt-1.5">{sol(w.rolloverOut, 4)}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="table min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="w-14">#</th>
                      <th>Coin</th>
                      <th className="text-right">Counted volume</th>
                      <th className="text-right">Traders</th>
                      <th className="text-right">Prize</th>
                      <th>Transfer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No coin traded this week. The whole pot rolled on.
                        </td>
                      </tr>
                    )}
                    {rows.slice(0, 10).map((r) => {
                      const p = r.rank !== null ? prizes.find((x) => x.rank === r.rank) : undefined;
                      return (
                        <tr key={r.coin.id} data-testid="week-row">
                          <td className="num text-[20px]">{r.rank ?? "–"}</td>
                          <td>
                            <Link href={`/c/${r.coin.slug}`} className="flex items-center gap-3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={r.coin.avatar} alt="" className="h-9 w-9 rounded-xl object-cover" />
                              <span className="font-semibold">{r.coin.name}</span>
                              <span className="mono text-[12px] text-muted-foreground">${r.coin.ticker}</span>
                            </Link>
                          </td>
                          <td className="num text-right text-[18px]">{sol(r.counted, 2)}</td>
                          <td className="mono text-right">{r.traders}</td>
                          <td className="mono text-right">{p ? sol(p.lamports, 4) : "—"}</td>
                          <td className="mono text-[12.5px]">
                            {p?.sig ? (
                              <a href={explorerUrl("tx", p.sig)} className="link" data-testid="prize-tx">
                                {p.sig.slice(0, 10)}…
                              </a>
                            ) : p ? (
                              <span className="text-warn">owed to {shortAddress(p.wallet)} · sent on the next update</span>
                            ) : r.qualifies ? (
                              "—"
                            ) : (
                              <span className="text-muted-foreground">did not qualify</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
