import type { Metadata } from "next";
import { MAX_IMAGE_BYTES } from "@/config/volumepad";
import { rulesView } from "@/server/views";
import { LaunchFlow } from "./LaunchFlow";

export const metadata: Metadata = { title: "Launch a coin" };
export const dynamic = "force-dynamic";

export default function LaunchPage() {
  const r = rulesView();
  const cfg = { launcher: r.launcher, pot: r.pot, platform: r.platform, minTraders: r.minTraders, walletCapSol: r.walletCapSol, prizes: r.prizes, maxImageMb: MAX_IMAGE_BYTES / 1024 / 1024 };
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-8 sm:py-16">
      <p className="label">Launching is free</p>
      <h1 className="display-xl mt-4 text-[clamp(52px,8vw,104px)]">Launch a coin</h1>
      <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
        Name it, add an image and one line, launch. From its first trade you earn {r.launcher} % of its creator fees, and it races this week&apos;s leaderboard for the pot.
      </p>
      <LaunchFlow cfg={cfg} />
    </section>
  );
}
