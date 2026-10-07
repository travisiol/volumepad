/**
 * VOLUMEPAD mechanic constants and env names. Imported by server modules (relative paths) and pages.
 * Every percentage, cap and window below is also stated on /docs, on the home page rules and on each coin page.
 */

/** Launching is free: the only transfer is the optional first buy. */
export const LAUNCH_FEE_LAMPORTS = BigInt(0);
/** Launches per wallet per 24 h. */
export const LAUNCHES_PER_DAY = 3;

/** Smallest withdrawal: 0.001 SOL. */
export const MIN_PAYOUT_LAMPORTS = BigInt(1_000_000);
/** The operator's creator vault is collected above this: 0.002 SOL. */
export const MIN_CLAIM_LAMPORTS = BigInt(2_000_000);
/** The held platform share buys $VOLUMEPAD once it reaches this: 0.01 SOL. */
export const MIN_BURN_LAMPORTS = BigInt(10_000_000);
/** A tick (fee sweep + week settlement + prize payouts) is due when the last one is older than this. */
export const TICK_EVERY_MS = 10 * 60_000;
/** Signatures read per coin per tick. */
export const SIGS_PER_COIN = 200;
/** Upload limit. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Rows on the home leaderboard. */
export const HOME_ROWS = 10;

/** Canonical SPL Memo v2 program id (https://spl.solana.com/memo). */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const num = (v: string | undefined, fallback: number, min = 0) => {
  const n = Number(v?.trim() || "");
  return Number.isFinite(n) && n >= min && v?.trim() ? n : fallback;
};

export interface Shares {
  launcher: number;
  pot: number;
  platform: number;
}

/**
 * Fee split in whole percent: LAUNCHER_SHARE (60) / POT_SHARE (30) / PLATFORM_SHARE (10).
 * If the three set values do not add up to 100 the defaults are used.
 */
export function shares(): Shares {
  const s = {
    launcher: Math.round(num(process.env["LAUNCHER_SHARE"], 60)),
    pot: Math.round(num(process.env["POT_SHARE"], 30)),
    platform: Math.round(num(process.env["PLATFORM_SHARE"], 10)),
  };
  return s.launcher + s.pot + s.platform === 100 ? s : { launcher: 60, pot: 30, platform: 10 };
}

/** Splits one creator fee. Platform and pot are rounded down; the launcher gets the rest (rounding included). */
export function splitFee(lamports: bigint, s: Shares = shares()): { launcher: bigint; pot: bigint; platform: bigint } {
  const platform = (lamports * BigInt(s.platform)) / BigInt(100);
  const pot = (lamports * BigInt(s.pot)) / BigInt(100);
  return { launcher: lamports - platform - pot, pot, platform };
}

export interface Rules {
  /** Counted volume per wallet per coin per week, in lamports. */
  walletCap: bigint;
  /** Distinct counted wallets a coin needs to rank. */
  minTraders: number;
  /** Prize split for ranks 1, 2, 3 in whole percent. */
  prizes: number[];
  /** Week length in ms and the anchor every week is counted from (a Monday 00:00 UTC by default). */
  weekMs: number;
  anchorMs: number;
}

/** WALLET_CAP_SOL (25), MIN_TRADERS (25), PRIZE_SPLIT ("50,30,20"), WEEK_HOURS (168), WEEK_ANCHOR (2026-01-05T00:00:00Z, a Monday). */
export function rules(): Rules {
  const capSol = num(process.env["WALLET_CAP_SOL"], 25, 0.000000001);
  const prizesIn = (process.env["PRIZE_SPLIT"]?.trim() || "50,30,20").split(",").map((x) => Math.round(Number(x)));
  const prizes = prizesIn.length >= 1 && prizesIn.every((x) => Number.isFinite(x) && x >= 0) && prizesIn.reduce((a, b) => a + b, 0) <= 100 ? prizesIn : [50, 30, 20];
  const anchor = Date.parse(process.env["WEEK_ANCHOR"]?.trim() || "2026-01-05T00:00:00Z");
  return {
    walletCap: BigInt(Math.round(capSol * 1e9)),
    minTraders: Math.max(1, Math.round(num(process.env["MIN_TRADERS"], 25, 1))),
    prizes,
    weekMs: Math.round(num(process.env["WEEK_HOURS"], 168, 1) * 3_600_000),
    anchorMs: Number.isFinite(anchor) ? anchor : Date.parse("2026-01-05T00:00:00Z"),
  };
}

/** Week number of a timestamp (ms). Week n runs [anchor + n·len, anchor + (n+1)·len). */
export function weekOf(ms: number, r: Rules = rules()): number {
  return Math.floor((ms - r.anchorMs) / r.weekMs);
}
export function weekStart(week: number, r: Rules = rules()): number {
  return r.anchorMs + week * r.weekMs;
}
export function weekEnd(week: number, r: Rules = rules()): number {
  return weekStart(week + 1, r);
}

export const ENV = {
  launchWebhook: () => process.env["LAUNCH_WEBHOOK"]?.trim() || null,
  launchSecret: () => process.env["LAUNCH_SECRET"]?.trim() || "",
  tickSecret: () => process.env["TICK_SECRET"]?.trim() || process.env["CRON_SECRET"]?.trim() || null,
  siteUrl: () => (process.env["NEXT_PUBLIC_SITE_URL"]?.trim() || "http://localhost:3976").replace(/\/$/, ""),
  jupiter: () => (process.env["JUPITER_API_URL"]?.trim() || "https://lite-api.jup.ag").replace(/\/$/, ""),
  platformMint: () => process.env["NEXT_PUBLIC_MINT"]?.trim() || null,
} as const;
