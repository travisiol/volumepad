import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyCa } from "@/components/CopyCa";
import { WeekCountdown } from "@/components/Live";
import { explorerUrl } from "@/config/solana";
import { shortAddress } from "@/lib/format";
import { sol, usd } from "@/lib/show";
import { db } from "@/server/db";
import { readMarket } from "@/server/market-data";
import { coinBySlug } from "@/server/store";
import { avatarOf, coinView, scheduleWork } from "@/server/views";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = coinBySlug(db(), (await params).slug);
  return c ? { title: `${c.name} ($${c.ticker})`, description: c.description } : { title: "Coin not found" };
}

export default async function CoinPage({ params }: { params: Promise<{ slug: string }> }) {
  scheduleWork();
  const c = coinBySlug(db(), (await params).slug);
  if (!c) notFound();
  const market = await readMarket(c.mint).catch(() => ({ mcapUsd: null, change24h: null, hasPair: false }));
  const v = coinView(c);
  const r = v.board.rules;
  const row = v.row;
  const pump = `https://pump.fun/coin/${c.mint}`;
  const dex = `https://dexscreener.com/solana/${c.mint}`;
  const prizesWon = v.won.reduce((s, p) => s + BigInt(p.lamports), BigInt(0));
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-8">
      <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
        <aside className="min-w-0 space-y-4">
          <div className="card p-5">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarOf(c)} alt="" className="h-16 w-16 rounded-2xl object-cover" />
              <div className="min-w-0">
                <h1 className="font-display truncate text-[32px] leading-none" data-testid="coin-name">
                  {c.name}
                </h1>
                <div className="mono mt-1.5 text-[14px] text-accent-deep">${c.ticker}</div>
              </div>
            </div>
            <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">{c.description}</p>
            <div className="mt-5 grid min-w-0 grid-cols-1 gap-2">
              <a href={pump} target="_blank" rel="noreferrer" className="btn-white inline-flex h-11 items-center justify-center rounded-full text-[14px]">
                Trade ${c.ticker} on pump.fun
              </a>
              <CopyCa value={c.mint} className="btn-dark w-full min-w-0 overflow-hidden rounded-xl px-3 py-2.5 text-left text-xs">
                <span className="label">Contract</span>
                <span className="mono mt-0.5 block truncate">{c.mint}</span>
              </CopyCa>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
              <a className="link" href={explorerUrl("token", c.mint)} target="_blank" rel="noreferrer">
                Solscan
              </a>
              <a className="link" href={dex} target="_blank" rel="noreferrer">
                DexScreener
              </a>
              {c.website && (
                <a className="link" href={c.website} target="_blank" rel="noreferrer">
                  Website
                </a>
              )}
              {c.xUrl && (
                <a className="link" href={c.xUrl} target="_blank" rel="noreferrer">
                  X
                </a>
              )}
              {c.telegram && (
                <a className="link" href={c.telegram} target="_blank" rel="noreferrer">
                  Telegram
                </a>
              )}
              {c.launchSig && (
                <a className="link" href={explorerUrl("tx", c.launchSig)} target="_blank" rel="noreferrer">
                  Launch tx
                </a>
              )}
            </div>
          </div>

          <div className="card p-5" data-testid="fee-card">
            <div className="label">Creator fees of this coin</div>
            <div className="num mt-3 text-[32px] leading-none">{sol(v.fees.fees, 4)}</div>
            <div className="mt-4 flex h-9 overflow-hidden rounded-xl text-[11.5px] font-semibold">
              <div className="grid place-items-center bg-ink text-white" style={{ width: `${r.launcher}%` }}>
                launcher {r.launcher} %
              </div>
              <div className="grid place-items-center bg-accent text-white" style={{ width: `${r.pot}%` }}>
                pot {r.pot} %
              </div>
              <div className="grid place-items-center bg-raised" style={{ width: `${r.platform}%` }}>
                {r.platform} %
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
              <Fact k="To the launcher" v={sol(v.fees.launcher, 4)} testid="launcher-fees" />
              <Fact k="To the pot" v={sol(v.fees.pot, 4)} />
              <Fact k="Buy & burn" v={sol(v.fees.platform, 4)} />
              <Fact k="Prizes won" v={sol(prizesWon, 4)} />
            </dl>
            <p className="mt-4 text-[12.5px] text-muted-foreground">Launcher {shortAddress(c.owner)}. Fees are read from each trade&apos;s pump.fun TradeEvent.</p>
          </div>

          <div className="card p-5">
            <div className="label">Market</div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
              <Fact k="Market cap" v={usd(market.mcapUsd)} />
              <Fact k="24h" v={market.change24h == null ? "—" : `${market.change24h >= 0 ? "+" : ""}${market.change24h.toFixed(1)} %`} />
            </dl>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="rounded-[28px] border border-border bg-panel p-5 sm:p-7" data-testid="coin-week">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="label">this week · week {v.board.week}</div>
                <div className="mt-3 flex items-baseline gap-4">
                  <span className="num text-[64px] leading-none" data-testid="coin-rank">
                    {row?.rank ? `#${row.rank}` : "—"}
                  </span>
                  <span className="text-[14px] text-muted-foreground">{row?.rank ? `of ${v.rankedCount} ranked` : row ? `needs ${Math.max(0, r.minTraders - row.traders)} more traders to rank` : "no trades this week yet"}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="label">week ends in</div>
                <div className="num mt-2 text-[28px]">
                  <WeekCountdown endAt={v.board.endAt} serverNow={v.board.serverNow} />
                </div>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-border bg-border sm:grid-cols-4">
              <Big k="counted volume" v={sol(row?.counted ?? "0", 2)} testid="coin-counted" />
              <Big k="raw volume" v={sol(row?.raw ?? "0", 2)} />
              <Big k="traders" v={`${row?.traders ?? 0} / ${r.minTraders}`} />
              <Big k="prize now" v={row?.projected ? sol(row.projected, 4) : "—"} />
            </dl>
            {row && (BigInt(row.capped) > BigInt(0) || BigInt(row.excluded) > BigInt(0)) && (
              <p className="mono mt-4 text-[12.5px] text-warn">
                Not counted: {sol(row.capped, 2)} over the {r.walletCapSol} SOL wallet cap ({row.cappedWallets} wallet{row.cappedWallets === 1 ? "" : "s"} at the cap), {sol(row.excluded, 2)} from the launcher or the launch wallet.
              </p>
            )}
            {row?.gap && <p className="mono mt-2 text-[12.5px] text-muted-foreground">{sol(row.gap, 2)} of counted volume behind the coin above.</p>}
            <Link href="/leaderboard" className="link mt-4 inline-block text-[13px]">
              Full leaderboard
            </Link>
          </div>

          <h2 className="display-lg mt-12 text-[clamp(32px,4vw,48px)]">Chart</h2>
          <div className="card mt-5 overflow-hidden">
            {market.hasPair ? (
              <iframe title={`${c.ticker} chart`} src={`${dex}?embed=1&theme=light&info=0&trades=0`} className="h-[460px] w-full" />
            ) : (
              <div className="px-6 py-12 text-center text-[14px] text-muted-foreground">
                No chart on DexScreener yet. Trades on the pump.fun curve show on{" "}
                <a href={pump} className="link" target="_blank" rel="noreferrer">
                  pump.fun
                </a>
                .
              </div>
            )}
          </div>

          <h2 className="display-lg mt-12 text-[clamp(32px,4vw,48px)]">Coin ledger</h2>
          <div className="card mt-5 overflow-x-auto">
            {v.ledger.length === 0 ? (
              <p className="px-6 py-10 text-center text-[14px] text-muted-foreground">No transfers for this coin yet. Prizes and token transfers for it land here.</p>
            ) : (
              <table className="table min-w-[560px]">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th className="text-right">Amount</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {v.ledger.map((x) => (
                    <tr key={x.id} data-testid="coin-ledger-row">
                      <td className="mono text-[12.5px]">{new Date(x.at).toUTCString().slice(5, 22)}</td>
                      <td className="text-[13.5px]">{x.note ?? x.kind}</td>
                      <td className="mono text-right">{x.mint ? x.amount : sol(x.amount, 4)}</td>
                      <td>
                        <a href={explorerUrl("tx", x.sig)} className="link mono text-[12.5px]" target="_blank" rel="noreferrer">
                          {x.sig.slice(0, 10)}…
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Fact({ k, v, testid }: { k: string; v: string; testid?: string }) {
  return (
    <div>
      <dt className="label">{k}</dt>
      <dd className="mono mt-1 text-[14px]" data-testid={testid}>
        {v}
      </dd>
    </div>
  );
}

function Big({ k, v, testid }: { k: string; v: string; testid?: string }) {
  return (
    <div className="bg-panel p-4">
      <dt className="label">{k}</dt>
      <dd className="num mt-2 text-[26px] leading-none" data-testid={testid}>
        {v}
      </dd>
    </div>
  );
}
