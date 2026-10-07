import type { Metadata } from "next";
import Link from "next/link";
import { LAUNCHES_PER_DAY, MIN_BURN_LAMPORTS, MIN_CLAIM_LAMPORTS, MIN_PAYOUT_LAMPORTS, TICK_EVERY_MS } from "@/config/volumepad";
import { sol } from "@/lib/show";
import { rulesView } from "@/server/views";

export const metadata: Metadata = { title: "Documentation" };
export const dynamic = "force-dynamic";

export default function Docs() {
  const r = rulesView();
  return (
    <div className="mx-auto max-w-[860px] px-4 py-12 sm:px-8 sm:py-16">
      <p className="label">how it works</p>
      <h1 className="display-xl mt-4 text-[clamp(52px,8vw,104px)]">Docs</h1>
      <p className="mt-5 text-[17px] leading-relaxed text-muted-foreground">How VOLUMEPAD works: launch, the fee split, counted volume, the weekly pot, payouts and the $VOLUMEPAD burn.</p>
      <div className="prose-docs">
        <h2>Overview</h2>
        <p>
          VOLUMEPAD launches pump.fun coins and gives their launchers something to win. Every coin&apos;s creator fees are split between its launcher, a weekly pot and a $VOLUMEPAD buy &amp; burn. Each week the coins are ranked by counted volume, and when the week closes the pot is paid to the
          launchers of the top {r.prizes.length} coins.
        </p>

        <h2>Launch</h2>
        <ul>
          <li>Name, ticker (2 to 10 letters or digits), an image, one line about the coin, optional website, X and Telegram links.</li>
          <li>
            Launching is free. An optional first buy is one SOL transfer you sign to the launch wallet, with a memo naming your request; the server reads it back from the chain before launching. The launch engine buys at launch and the tokens are forwarded to you.
          </li>
          <li>
            The coin is created on pump.fun by the owner&apos;s launch engine, from the VOLUMEPAD launch wallet, which is the coin&apos;s <strong>creator of record</strong> on pump.fun and receives its creator fees. On VOLUMEPAD you are the coin&apos;s launcher: your wallet is credited and paid.
          </li>
          <li>Up to {LAUNCHES_PER_DAY} launches per wallet a day.</li>
        </ul>

        <h2>Fees</h2>
        <p>Every trade on the pump.fun curve pays a creator fee to the launch wallet. VOLUMEPAD reads each trade&apos;s TradeEvent from the chain (signatures of the coin&apos;s bonding curve, every {TICK_EVERY_MS / 60_000} minutes or so) and splits its creator fee:</p>
        <ul>
          <li>
            <strong>{r.launcher} % to the launcher</strong>, credited as trades are read and withdrawable any time from <Link href="/manage">My coins</Link> ({sol(MIN_PAYOUT_LAMPORTS, 3)} minimum).
          </li>
          <li>
            <strong>{r.pot} % to the weekly pot</strong> of the week the trade happened in. A fee read after its week has closed goes to the open week&apos;s pot.
          </li>
          <li>
            <strong>{r.platform} % to $VOLUMEPAD</strong>: once collected it buys $VOLUMEPAD through Jupiter (simulated first) and burns exactly what was bought, in batches of {sol(MIN_BURN_LAMPORTS, 3)} or more. Until the $VOLUMEPAD mint is set the share is held, and shown as held.
          </li>
        </ul>
        <p>
          The launch wallet collects its pump.fun creator vault when it holds more than {sol(MIN_CLAIM_LAMPORTS, 3)}. Fees attributed from trades but not yet collected are shown separately from collected ones on the leaderboard. Trades after a coin leaves the curve for PumpSwap are not read.
        </p>

        <h2>Counted volume</h2>
        <p>A coin&apos;s counted volume for a week is the SOL volume (buys and sells) of its pump.fun curve trades with a timestamp inside the week, after these rules:</p>
        <ul>
          <li>
            <strong>Wallet cap</strong>: each wallet counts for at most {r.walletCapSol} SOL per coin per week, in trade order. The excess is shown as capped.
          </li>
          <li>
            <strong>Launcher filter</strong>: trades from the launcher&apos;s wallet and from the launch wallet (which is also the creator of record and makes the first buy) are not counted, and those wallets are not counted as traders.
          </li>
          <li>
            <strong>Trader minimum</strong>: a coin needs at least {r.minTraders} different counted wallets in the week to rank and to win. Coins below it are listed under the ranked ones.
          </li>
          <li>
            <strong>Ties</strong>: on equal counted volume, the coin whose first counted trade of the week came earlier ranks higher.
          </li>
        </ul>
        <p>These rules make wash trading expensive, not impossible: someone can still spread volume across many wallets. They are enforced in code, the same for every coin.</p>

        <h2>The week and the payout</h2>
        <ul>
          <li>A week runs Monday 00:00 UTC to Sunday 23:59 UTC.</li>
          <li>
            The first update after the week closes freezes the standings and sends the pot to the launcher wallets of the top {r.prizes.length} ranked coins: {r.prizes.map((p, i) => `#${i + 1} ${p} %`).join(", ")}. Amounts are rounded down to the lamport; the remainder rolls into the next week.
          </li>
          <li>If fewer coins qualify than there are prizes, the unpaid shares roll into next week&apos;s pot.</li>
          <li>Each prize is an operator-signed SOL transfer, simulated before it is sent, recorded on the <Link href="/ledger">ledger</Link> and on <Link href="/weeks">Past weeks</Link> with its transaction. A week is settled once; a prize that could not be sent stays owed and is retried on the next update.</li>
          <li>Prizes are paid from the launch wallet. A pot that includes fees not yet collected from pump.fun is paid once they are.</li>
        </ul>

        <h2>Updates</h2>
        <p>
          Nothing runs in the background. An update (read trades, collect fees, settle a closed week, send prizes, buy &amp; burn) runs from a scheduled job and from a page visit when the last one is more than {TICK_EVERY_MS / 60_000} minutes old. The leaderboard refreshes in the page every 30 seconds.
        </p>

        <h2>Launch webhook</h2>
        <p>
          For the operator: <code>LAUNCH_WEBHOOK</code> receives <code>POST</code> JSON <code>{"{id, name, ticker, description, imageDataUrl, website, twitter, telegram, launcher, firstBuyLamports}"}</code> with header <code>x-volumepad-secret</code>, and answers{" "}
          <code>{"{mint, signature, creator, tokensBought?}"}</code>. Without it, or without the operator key, launching answers &quot;Launching is not open yet.&quot;
        </p>

        <h2 id="faq">FAQ</h2>
        <ul>
          <li>
            <strong>Can I lose money?</strong> Yes. Meme coins are speculative and can go to zero. Prizes only exist if trading produces fees. Nothing here is financial advice.
          </li>
          <li>
            <strong>Can I trade my own coin?</strong> Yes, but your trades never count toward its volume.
          </li>
          <li>
            <strong>Why is my coin not ranked?</strong> It has fewer than {r.minTraders} different counted wallets this week.
          </li>
        </ul>
      </div>
    </div>
  );
}
