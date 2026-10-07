import Image from "next/image";
import Link from "next/link";
import { LiveBoard } from "@/components/Board";
import { LiveStrip } from "@/components/Pot";
import { SITE } from "@/config/site";
import { explorerUrl } from "@/config/solana";
import { sol } from "@/lib/show";
import { homeBoard, ledger, platformStats, recentWinners, scheduleWork } from "@/server/views";

export const dynamic = "force-dynamic";

export default function Home() {
  scheduleWork();
  const b = homeBoard();
  const r = b.rules;
  const winners = recentWinners(6);
  const stats = platformStats();
  const burns = ledger(200)
    .filter((x) => x.kind === "buy" || x.kind === "burn")
    .slice(0, 5);
  const capSol = `${r.walletCapSol} SOL`;
  const prizeText = r.prizes.map((p) => `${p} %`).join(" / ");

  const faq: [string, string][] = [
    ["What is VOLUMEPAD?", `A Solana launchpad for pump.fun coins where the launcher earns ${r.launcher} % of the coin's creator fees and competes for a weekly pot.`],
    ["Where does the weekly pot come from?", `${r.pot} % of the creator fees of every coin launched here goes into the pot of the week the trade happened in.`],
    ["How are winners picked?", `By counted volume: SOL volume of the coin's pump.fun curve trades in the week, with each wallet capped at ${capSol}, the launcher's and the launch wallet's trades left out, and at least ${r.minTraders} different wallets needed to rank. Ties go to the coin whose first counted trade came first.`],
    ["When am I paid?", `Your fee share is credited as trades are read (every few minutes) and withdrawable any time from My coins. Prizes are sent to the launcher wallets of the top coins on the first update after the week closes, and every transfer is on the ledger.`],
    ["What if fewer than 3 coins qualify?", "The unpaid share of the pot rolls into next week's pot. The Past weeks page shows it."],
    ["What happens to $VOLUMEPAD?", `${r.platform} % of creator fees buys $VOLUMEPAD and burns it. Until the token's mint is set, that share is held and shown as held.`],
    ["Can I lose money?", "Yes. Meme coins are speculative and can go to zero. A prize only exists if trading produces fees. Nothing here is financial advice."],
  ];

  return (
    <>
      {/* 1 · hero */}
      <section className="relative overflow-hidden">
        <div className="fade-edges pointer-events-none absolute inset-y-0 right-0 hidden w-[72%] max-w-[1150px] lg:block" aria-hidden="true">
          <Image src="/hero.png" alt="" fill sizes="72vw" priority className="object-contain object-right" />
        </div>
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-6 px-4 pb-14 pt-10 sm:px-8 lg:min-h-[680px] lg:grid-cols-[48%_52%] lg:pb-16 lg:pt-6">
          <div className="relative z-10 rise">
            <span className="mono inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-[12px]">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> weekly launch contest
            </span>
            <h1 className="display-xl mt-6 max-w-[680px] text-[58px] sm:text-[84px] lg:text-[104px]">
              Launch.
              <br />
              Rank.
              <br />
              <span className="text-accent">Win the pot.</span>
            </h1>
            <p className="mt-6 max-w-[520px] text-[17px] leading-[1.55] text-muted-foreground">
              Launch a pump.fun coin through VOLUMEPAD. Its creator fees pay you {r.launcher} % and fill a weekly pot, and the launchers of the top {r.prizes.length} coins by counted volume take the pot when the week closes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/launch" className="btn-hot inline-flex h-12 items-center rounded-full px-7 text-[15px]" data-testid="hero-launch">
                Launch a coin
              </Link>
              <Link href="/leaderboard" className="btn-line inline-flex h-12 items-center rounded-full px-7 text-[15px]">
                View leaderboard
              </Link>
            </div>
            <div className="mt-8 max-w-[620px]">
              <LiveStrip initial={b} />
            </div>
          </div>
          <div className="fade-edges relative -mx-4 aspect-[4/3] sm:mx-0 lg:hidden">
            <Image src="/hero.png" alt="" fill sizes="100vw" priority className="object-cover object-[75%_50%]" />
          </div>
        </div>
      </section>

      {/* 2 · top 10 */}
      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-8">
        <div className="rounded-[28px] border border-border bg-panel p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="display-lg text-[38px] sm:text-[56px]">This week&apos;s top 10</h2>
              <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
                Ranked by counted volume: the wallet cap and the launcher filter are applied before the table updates. Refreshes every 30 seconds.
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/leaderboard" className="btn-line inline-flex h-11 items-center rounded-full px-5 text-[14px]">
                Full leaderboard
              </Link>
              <Link href="/launch" className="btn-white inline-flex h-11 items-center rounded-full px-5 text-[14px]">
                Launch a coin
              </Link>
            </div>
          </div>
          <div className="mt-6">
            <LiveBoard initial={b} limit={10} />
          </div>
        </div>
      </section>

      {/* 3 · how it works */}
      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-8">
        <h2 className="display-lg text-[38px] sm:text-[56px]">How the weekly pot works</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["01", "Launch", "Name, ticker, image, one line. The coin launches on pump.fun; you are its launcher here. Launching is free."],
            ["02", "Fees split", `Every trade pays pump.fun's creator fee. We split it: ${r.launcher} % to you, ${r.pot} % to the weekly pot, ${r.platform} % to $VOLUMEPAD buy & burn.`],
            ["03", "Volume counts", `Trades on the coin's curve add counted volume after the anti-wash rules. The board updates every few minutes.`],
            ["04", `Top ${r.prizes.length} get paid`, `When the week closes, the pot goes to the launchers ranked ${r.prizes.map((_, i) => i + 1).join(", ")}: ${prizeText}.`],
          ].map(([n, t, d]) => (
            <div key={n} className="card p-6">
              <span className="mono inline-flex rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-semibold text-white">{n}</span>
              <h3 className="display-lg mt-5 text-[28px]">{t}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4 · rules */}
      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-8" id="rules">
        <div className="grid gap-8 lg:grid-cols-[36%_1fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <h2 className="display-lg text-[38px] sm:text-[56px]">Counted volume, not noise</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">The board rewards coins that many different wallets trade, not a launcher trading with themselves or one wallet looping.</p>
            <div className="mt-6 overflow-hidden rounded-[18px] border border-border bg-panel font-mono text-[13px]">
              <div className="flex justify-between border-b border-border px-4 py-3">
                <span>raw volume</span>
                <span className="text-muted-foreground">every curve trade</span>
              </div>
              <div className="flex justify-between border-b border-border px-4 py-3">
                <span>− filters</span>
                <span className="text-muted-foreground">cap · launcher · launch wallet</span>
              </div>
              <div className="flex justify-between bg-accent px-4 py-3 text-white">
                <span>= counted volume</span>
                <span>ranks the week</span>
              </div>
            </div>
          </div>
          <div className="grid gap-3">
            {[
              ["Wallet cap", `Each wallet counts for at most ${capSol} of volume per coin per week. Anything above is shown as capped and not counted.`],
              ["Launcher filter", "Trades from the launcher's own wallet, and from the VOLUMEPAD launch wallet (including the first buy), never count."],
              ["Trader minimum", `A coin needs at least ${r.minTraders} different counted wallets in the week to rank and to win.`],
              ["Weekly window", "The contest runs Monday 00:00 UTC to Sunday 23:59 UTC, by the timestamp pump.fun writes in each trade."],
              ["Ties", "Equal counted volume: the coin whose first counted trade of the week came earlier ranks higher."],
              ["Final standings", "When the week closes the standings freeze, the prizes are sent, and both stay on the Past weeks page with their transactions."],
            ].map(([t, d]) => (
              <div key={t} className="card flex flex-col gap-1 p-5 sm:flex-row sm:items-baseline sm:gap-6">
                <h3 className="mono w-40 shrink-0 text-[13px] font-semibold uppercase tracking-[0.08em]">{t}</h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5 · past winners */}
      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-8">
        <div className="rounded-[28px] border border-border bg-panel p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="display-lg text-[38px] sm:text-[56px]">Past winners</h2>
              <p className="mt-2 text-[15px] text-muted-foreground">Every finished week keeps its final standings, its pot and its payout transactions.</p>
            </div>
            <Link href="/weeks" className="btn-line inline-flex h-11 items-center rounded-full px-5 text-[14px]">
              All past weeks
            </Link>
          </div>
          {winners.length === 0 ? (
            <div className="mt-6 rounded-[22px] border border-dashed border-border px-6 py-12 text-center" data-testid="winners-empty">
              <p className="display-lg text-[28px]">No finished weeks yet</p>
              <p className="mt-2 text-[15px] text-muted-foreground">The first standings freeze when this week closes, Sunday 23:59 UTC.</p>
              <Link href="/leaderboard" className="mono mt-4 inline-block text-[13px] text-accent-deep underline underline-offset-4">
                current week · live
              </Link>
            </div>
          ) : (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="winners">
              {winners.map((p) => (
                <li key={`${p.week}-${p.rank}`} className="rounded-[18px] border border-border p-4">
                  <div className="flex items-center justify-between">
                    <span className="mono text-[12px] text-muted-foreground">
                      week {p.week} · #{p.rank}
                    </span>
                    <span className="num text-[20px]">{sol(p.lamports, 3)}</span>
                  </div>
                  {p.coin && (
                    <Link href={`/c/${p.coin.slug}`} className="mt-3 flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.coin.avatar} alt="" className="h-9 w-9 rounded-xl object-cover" />
                      <span className="font-semibold">{p.coin.name}</span>
                      <span className="mono text-[12px] text-muted-foreground">${p.coin.ticker}</span>
                    </Link>
                  )}
                  <div className="mono mt-3 text-[12px]">
                    {p.sig ? (
                      <a href={explorerUrl("tx", p.sig)} className="text-accent-deep underline underline-offset-4">
                        paid · view transfer
                      </a>
                    ) : (
                      <span className="text-warn">owed · sent on the next update</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 6 · token */}
      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-8">
        <div className="grid gap-8 rounded-[28px] bg-ink p-6 text-white sm:p-10 lg:grid-cols-2">
          <div>
            <h2 className="display-lg text-[38px] sm:text-[56px]">
              {r.platform} % buys and burns <span className="text-accent">${SITE.ticker}</span>
            </h2>
            <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-white/70">Every coin launched here sends {r.platform} % of its creator fees to buy $VOLUMEPAD and burn it. Each buy and each burn is a transaction on the ledger.</p>
            <ul className="mono mt-6 space-y-2 text-[14px]">
              <li>{r.launcher} % launcher earnings</li>
              <li>{r.pot} % weekly pot</li>
              <li className="text-accent">{r.platform} % $VOLUMEPAD buy & burn</li>
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/ledger" className="btn-hot inline-flex h-11 items-center rounded-full px-6 text-[14px]">
                View burn ledger
              </Link>
              <Link href="/docs" className="inline-flex h-11 items-center rounded-full border border-white/25 px-6 text-[14px] font-bold hover:bg-white/10">
                Read docs
              </Link>
            </div>
          </div>
          <div className="rounded-[20px] border border-white/15 p-5 font-mono text-[13px]">
            <div className="grid grid-cols-3 gap-3 border-b border-white/15 pb-3 text-white/60">
              <span>held</span>
              <span>spent</span>
              <span>prizes paid</span>
            </div>
            <div className="grid grid-cols-3 gap-3 py-3 text-[15px]">
              <span>{sol(stats.platformHeld, 4)}</span>
              <span>{sol(stats.platformSpent, 4)}</span>
              <span>{sol(stats.prizesPaid, 4)}</span>
            </div>
            <div className="mt-2 border-t border-white/15 pt-3 text-white/60">latest buys and burns</div>
            {burns.length === 0 ? (
              <p className="py-6 text-white/70">
                No burns yet.
                <span className="mt-1 block text-[12px] text-white/50">Burns appear here once enough of the platform share has been collected.</span>
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-white/10">
                {burns.map((x) => (
                  <li key={x.id} className="flex justify-between py-2">
                    <span>{x.kind}</span>
                    <a href={explorerUrl("tx", x.sig)} className="text-accent underline underline-offset-4">
                      {x.sig.slice(0, 8)}…
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 7 · FAQ */}
      <section className="mx-auto max-w-[1200px] px-4 pb-20 pt-10 sm:px-8" id="faq">
        <div className="grid gap-8 lg:grid-cols-[36%_1fr]">
          <h2 className="display-lg text-[38px] sm:text-[56px]">FAQ</h2>
          <div className="grid gap-3">
            {faq.map(([q, a]) => (
              <details key={q} className="group rounded-[18px] border border-border bg-panel p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {q}
                  <span className="mono text-accent transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
