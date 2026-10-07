import type { Metadata } from "next";
import Link from "next/link";
import { LiveBoard } from "@/components/Board";
import { PotPanel } from "@/components/Pot";
import { board, scheduleWork } from "@/server/views";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  scheduleWork();
  const b = board(200);
  const r = b.rules;
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-8 sm:py-16">
      <p className="label">week {b.week} · live</p>
      <h1 className="display-xl mt-4 text-[clamp(52px,8vw,104px)]">Leaderboard</h1>
      <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">
        Every coin launched here, ranked by counted volume this week. Each wallet counts up to {r.walletCapSol} SOL per coin, the launcher&apos;s and the launch wallet&apos;s trades are left out, and a coin needs {r.minTraders} different wallets to rank. When the week closes the top {r.prizes.length} launchers take {r.prizes.map((p) => `${p} %`).join(" / ")} of the pot.{" "}
        <Link href="/#rules" className="link">
          All rules
        </Link>
      </p>
      <div className="mt-10">
        <PotPanel initial={b} />
      </div>
      <div className="mt-8 rounded-[28px] border border-border bg-panel p-4 sm:p-6">
        <LiveBoard initial={b} full />
      </div>
      <p className="mt-4 text-[13px] text-muted-foreground">
        &quot;Prize now&quot; is what the place would pay if the week ended with the current pot. Raw volume includes trades that do not count. Coins that have not reached {r.minTraders} traders are listed below the ranked ones.
      </p>
    </section>
  );
}
