/** Site identity. */
export const SITE = {
  name: "VOLUMEPAD",
  ticker: "VOLUMEPAD",
  hook: "Launch. Rank. Win the pot.",
  description: "Launch a pump.fun coin through VOLUMEPAD. 60% of its creator fees go to you, 30% to a weekly pot, and the launchers of the top 3 coins by counted volume take the pot every week.",
  port: 3976,
  xHandle: (process.env.NEXT_PUBLIC_X_HANDLE?.trim() || "").replace(/^@/, ""),
  url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3976",
  disclaimer: "Coins launched here are speculative meme coins: you can lose everything you put in. Prizes depend on fees that trading may never produce. Not financial advice. Not affiliated with pump.fun.",
} as const;
