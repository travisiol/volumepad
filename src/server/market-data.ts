/**
 * Live market reads per mint, cached 60 s: market cap (pump.fun JSON, DexScreener fallback) and the
 * 24 h change + whether a DexScreener pair exists (for the chart embed). Never invents a number: a
 * failed read is `null`.
 */
import { cached, pumpCoin } from "./chain.ts";

export interface Market {
  mcapUsd: number | null;
  change24h: number | null;
  hasPair: boolean;
}

const DEX_API = () => process.env["DEXSCREENER_API_URL"] || "https://api.dexscreener.com";

export type MarketReader = (mint: string) => Promise<Market>;

export const readMarket: MarketReader = (mint) =>
  cached(`market:${mint}`, 60_000, async () => {
    const coin = await pumpCoin(mint).catch(() => null);
    let change24h: number | null = null;
    let hasPair = false;
    try {
      const r = await fetch(`${DEX_API()}/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const pairs = (await r.json()) as { liquidity?: { usd?: number }; priceChange?: { h24?: number } }[];
        if (Array.isArray(pairs) && pairs.length) {
          hasPair = true;
          const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
          const c = Number(best.priceChange?.h24);
          change24h = Number.isFinite(c) ? c : null;
        }
      }
    } catch {
      // no change figure this time
    }
    return { mcapUsd: coin && coin.marketCapUsd > 0 ? coin.marketCapUsd : null, change24h, hasPair };
  });

/** Market of many mints, without throwing. */
export async function readMarkets(mints: string[], reader: MarketReader = readMarket): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  await Promise.all(
    mints.map(async (m) => {
      out.set(m, await reader(m).catch(() => ({ mcapUsd: null, change24h: null, hasPair: false })));
    }),
  );
  return out;
}

/** "$12.3K" style, as in the posts. */
export function compactUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
