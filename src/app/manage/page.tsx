import type { Metadata } from "next";
import { CLUSTER } from "@/config/solana";
import { MyCoins } from "./Manage";

export const metadata: Metadata = { title: "My coins" };

export default function ManagePage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-8 sm:py-16">
      <p className="label">launchers</p>
      <h1 className="display-xl mt-4 text-[clamp(52px,8vw,104px)]">My coins</h1>
      <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">Your coins and their rank this week, your share of their creator fees (withdraw any time) and the prizes you have won.</p>
      <MyCoins cluster={CLUSTER} />
    </div>
  );
}
