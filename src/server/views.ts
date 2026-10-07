/** What the pages show, read from our tables (+ live market reads, cached 60 s, on the coin page). */
import { after } from "next/server";
import { HOME_ROWS, rules, shares, weekEnd, weekOf, weekStart } from "../config/volumepad.ts";
import { burnBook } from "./burn.ts";
import { now as clockNow } from "./clock.ts";
import { db as defaultDb } from "./db.ts";
import { listLedger } from "./operator.ts";
import type { LedgerRow } from "./operator.ts";
import { runTick, tickDue, lastTick } from "./tick.ts";
import { carry, getWeek, listWeeks, openPot, prizesOf, prizesOfWallet, standings } from "./week.ts";
import type { PrizeRow, Standing, WeekRow } from "./week.ts";
import { coinFees, getCoin, kvGet, listCoins, mediaUrl, ownerBalance, coinsOf } from "./store.ts";
import type { CoinRow } from "./store.ts";

const ZERO = BigInt(0);

export const avatarOf = (c: Pick<CoinRow, "imageId">) => mediaUrl(c.imageId) ?? "/mark.png";

export interface CoinChip {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  avatar: string;
  mint: string;
}
export const chip = (c: CoinRow): CoinChip => ({ id: c.id, slug: c.slug, name: c.name, ticker: c.ticker, avatar: avatarOf(c), mint: c.mint });

export interface BoardRow {
  rank: number | null;
  coin: CoinChip;
  counted: string;
  raw: string;
  capped: string;
  excluded: string;
  traders: number;
  cappedWallets: number;
  qualifies: boolean;
  /** Prize at the current pot if the week ended now (lamports), null outside the paid places. */
  projected: string | null;
  /** Counted volume behind the row above (lamports); null for the first row. */
  gap: string | null;
}

export interface PotView {
  total: string;
  fromFees: string;
  rollover: string;
  /** Part of the pot backed by creator fees already collected from pump.fun (oldest fees first). */
  collected: string;
  /** Part attributed from trades but not yet collected (collected at the next claim). */
  uncollected: string;
}

export interface Board {
  week: number;
  startAt: number;
  endAt: number;
  serverNow: number;
  pot: PotView;
  rows: BoardRow[];
  lastTick: number | null;
  rules: { walletCapSol: number; minTraders: number; prizes: number[]; launcher: number; pot: number; platform: number };
}

export function rulesView(): Board["rules"] {
  const r = rules();
  const s = shares();
  return { walletCapSol: Number(r.walletCap) / 1e9, minTraders: r.minTraders, prizes: r.prizes, launcher: s.launcher, pot: s.pot, platform: s.platform };
}

/** Pot share not yet backed by collected fees: fee events are covered oldest first by what has been claimed. */
function uncollectedPot(db = defaultDb()): bigint {
  let claimed = BigInt(kvGet(db, "claimedLamports") ?? "0");
  let uncollected = ZERO;
  for (const e of db.prepare("SELECT lamports, pot FROM fee_events ORDER BY at, slot, sig").all() as { lamports: string; pot: string }[]) {
    const l = BigInt(e.lamports);
    if (claimed >= l) claimed -= l;
    else {
      claimed = ZERO;
      uncollected += BigInt(e.pot);
    }
  }
  return uncollected;
}

export function potView(week: number, db = defaultDb()): PotView {
  const p = openPot(db, week);
  const un = uncollectedPot(db);
  const uncollected = un < p.total ? un : p.total;
  return { total: p.total.toString(), fromFees: p.fromFees.toString(), rollover: p.rollover.toString(), collected: (p.total - uncollected).toString(), uncollected: uncollected.toString() };
}

export function toRows(table: Standing[], pot: bigint, prizes: number[], coins: (id: string) => CoinRow | null): BoardRow[] {
  const out: BoardRow[] = [];
  let prev: bigint | null = null;
  let prevQualifies: boolean | null = null;
  for (const s of table) {
    // the gap is measured inside a group: ranked coins against ranked coins, the others against the others
    if (prevQualifies !== null && prevQualifies !== s.qualifies) prev = null;
    prevQualifies = s.qualifies;
    const c = coins(s.coinId);
    if (!c) continue;
    const counted = BigInt(s.counted);
    const pct = s.rank !== null ? prizes[s.rank - 1] : undefined;
    out.push({
      rank: s.rank,
      coin: chip(c),
      counted: s.counted,
      raw: s.raw,
      capped: s.capped,
      excluded: s.excluded,
      traders: s.traders,
      cappedWallets: s.cappedWallets,
      qualifies: s.qualifies,
      projected: pct !== undefined ? ((pot * BigInt(pct)) / BigInt(100)).toString() : null,
      gap: prev === null ? null : (prev - counted).toString(),
    });
    prev = counted;
  }
  return out;
}

/** The live leaderboard of the open week. */
export function board(limit = 100): Board {
  const db = defaultDb();
  const t = clockNow();
  const week = weekOf(t);
  const r = rules();
  const pot = potView(week, db);
  const cache = new Map<string, CoinRow | null>();
  const coins = (id: string) => {
    if (!cache.has(id)) cache.set(id, getCoin(db, id));
    return cache.get(id) ?? null;
  };
  const rows = toRows(standings(db, week, r), BigInt(pot.total), r.prizes, coins).slice(0, limit);
  return { week, startAt: weekStart(week, r), endAt: weekEnd(week, r), serverNow: t, pot, rows, lastTick: lastTick(db), rules: rulesView() };
}

export const homeBoard = () => board(HOME_ROWS);

export interface PastWeek {
  w: WeekRow;
  rows: BoardRow[];
  prizes: (PrizeRow & { coin: CoinChip | null })[];
}

export function pastWeeks(limit = 52): PastWeek[] {
  const db = defaultDb();
  return listWeeks(db, limit).map((w) => pastWeek(w));
}

function pastWeek(w: WeekRow): PastWeek {
  const db = defaultDb();
  const table = JSON.parse(w.standings) as Standing[];
  const prizes = JSON.parse(w.prizes) as number[];
  const coin = (id: string) => getCoin(db, id);
  return {
    w,
    rows: toRows(table, BigInt(w.pot), prizes, coin),
    prizes: prizesOf(db, w.week).map((p) => {
      const c = getCoin(db, p.coinId);
      return { ...p, coin: c ? chip(c) : null };
    }),
  };
}

export function oneWeek(week: number): PastWeek | null {
  const w = getWeek(defaultDb(), week);
  return w ? pastWeek(w) : null;
}

/** Winners across past weeks (newest first), for the home page. */
export function recentWinners(limit = 6): (PrizeRow & { coin: CoinChip | null; endAt: number })[] {
  const db = defaultDb();
  const rows = db.prepare("SELECT p.*, w.endAt AS endAt FROM prizes p JOIN weeks w ON w.week = p.week ORDER BY p.week DESC, p.rank LIMIT ?").all(limit) as unknown as (PrizeRow & { endAt: number })[];
  return rows.map((p) => {
    const c = getCoin(db, p.coinId);
    return { ...p, coin: c ? chip(c) : null };
  });
}

/** One coin's week, fees and earnings. */
export function coinView(c: CoinRow) {
  const b = board(10_000);
  const row = b.rows.find((x) => x.coin.id === c.id) ?? null;
  const db = defaultDb();
  const fees = coinFees(db, c.id);
  const won = (db.prepare("SELECT * FROM prizes WHERE coinId = ? ORDER BY week DESC").all(c.id) as unknown as PrizeRow[]);
  const ledger = (db.prepare('SELECT id, kind, "to", mint, amount, sig, at, note, cluster, coinId FROM ledger WHERE coinId = ? OR mint = ? ORDER BY at DESC LIMIT 50').all(c.id, c.mint) as unknown as LedgerRow[]);
  return { board: b, row, fees, won, ledger, rankedCount: b.rows.filter((x) => x.rank !== null).length };
}

/** A launcher's coins with their rank this week, fee earnings and prizes. */
export function launcherView(wallet: string) {
  const db = defaultDb();
  const b = board(10_000);
  const coins = coinsOf(db, wallet).map((c) => {
    const row = b.rows.find((x) => x.coin.id === c.id) ?? null;
    return { coin: chip(c), rank: row?.rank ?? null, counted: row?.counted ?? "0", traders: row?.traders ?? 0, qualifies: row?.qualifies ?? false, fees: coinFees(db, c.id).launcher.toString() };
  });
  const bal = ownerBalance(db, wallet);
  const prizes = prizesOfWallet(db, wallet).map((p) => {
    const c = getCoin(db, p.coinId);
    return { ...p, coin: c ? chip(c) : null };
  });
  const prizePaid = prizes.filter((p) => p.status === "paid").reduce((s, p) => s + BigInt(p.lamports), ZERO);
  const prizeOwed = prizes.filter((p) => p.status !== "paid").reduce((s, p) => s + BigInt(p.lamports), ZERO);
  return {
    coins,
    balance: { earned: bal.earned.toString(), paid: bal.paid.toString(), available: bal.available.toString() },
    prizes,
    prizePaid: prizePaid.toString(),
    prizeOwed: prizeOwed.toString(),
    week: { endAt: b.endAt, serverNow: b.serverNow },
  };
}

/** Real counts for the token block; zeros on a cold start. */
export function platformStats() {
  const db = defaultDb();
  const book = burnBook(db);
  const paid = db.prepare("SELECT lamports FROM prizes WHERE status = 'paid'").all() as { lamports: string }[];
  return {
    coins: listCoins(db, 100_000).length,
    platformHeld: book.held.toString(),
    platformSpent: book.spent.toString(),
    burnedUnits: book.burned.toString(),
    prizesPaid: paid.reduce((s, r) => s + BigInt(r.lamports), ZERO).toString(),
    carry: carry(db).toString(),
  };
}

export function ledger(limit = 200): LedgerRow[] {
  return listLedger(defaultDb(), limit);
}

/** Page-load trigger: schedules the tick with after() when overdue. */
export function scheduleWork() {
  try {
    const db = defaultDb();
    if (!tickDue(db)) return;
    after(async () => {
      await runTick(db).catch(() => null);
    });
  } catch {
    // outside a request scope (build time): nothing to schedule
  }
}
