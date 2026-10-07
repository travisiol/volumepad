/**
 * The week. Each coin's counted volume = SOL volume of its pump.fun curve trades inside the week (TradeEvent
 * timestamps), with the anti-wash rules applied here, in code:
 *  - per wallet per coin, counted volume is capped at WALLET_CAP_SOL for the week (trades in time order);
 *  - trades by the launcher's wallet, by the operator and by the coin's creator of record are not counted;
 *  - a coin needs ≥ MIN_TRADERS distinct counted wallets to rank.
 * Ties on counted volume: the coin whose first counted trade came earlier ranks higher.
 * At week end (first tick after the boundary) `settleDue()` freezes the standings and owes the pot to the
 * launchers of the top coins (PRIZE_SPLIT, 50/30/20 by default); `payPrizes()` sends each prize from the
 * operator (simulated first, every tx on the ledger). Unpaid shares and rounding dust roll into the next week.
 */
import type { DatabaseSync } from "node:sqlite";
import { rules, weekEnd, weekOf, weekStart } from "../config/volumepad.ts";
import type { Rules } from "../config/volumepad.ts";
import { db as defaultDb } from "./db.ts";
import { operatorAddress, operatorKeypair, sendSol } from "./operator.ts";
import type { PayoutResult } from "./operator.ts";
import { settledThrough } from "./sweep.ts";
import { getCoin, kvGet, kvSet, listCoins, potOfWeek, tradesOfWeek } from "./store.ts";
import type { CoinRow } from "./store.ts";

const ZERO = BigInt(0);

export interface Standing {
  coinId: string;
  /** SOL volume of every curve trade of the week, lamports. */
  raw: string;
  /** After the wallet cap and the exclusions, lamports. */
  counted: string;
  /** Lamports not counted because of the wallet cap. */
  capped: string;
  /** Lamports not counted because the launcher, operator or creator traded. */
  excluded: string;
  traders: number;
  /** Wallets whose counted volume hit the cap this week. */
  cappedWallets: number;
  qualifies: boolean;
  /** 1-based rank among qualifying coins; null when the coin does not qualify. */
  rank: number | null;
  /** First counted trade (ms), the tie-break. */
  firstAt: number | null;
}

/** Standings of `week`, qualifying coins first (ranked), then the others by counted volume. */
export function standings(db: DatabaseSync, week: number, r: Rules = rules(), operator: string | null = operatorAddress()): Standing[] {
  const coins = new Map<string, CoinRow | null>();
  const coin = (id: string) => {
    if (!coins.has(id)) coins.set(id, getCoin(db, id));
    return coins.get(id) ?? null;
  };
  type Acc = { raw: bigint; counted: bigint; capped: bigint; excluded: bigint; wallets: Map<string, bigint>; firstAt: number | null; firstKey: string };
  const acc = new Map<string, Acc>();
  for (const t of tradesOfWeek(db, week)) {
    const c = coin(t.coinId);
    if (!c) continue;
    let a = acc.get(t.coinId);
    if (!a) {
      a = { raw: ZERO, counted: ZERO, capped: ZERO, excluded: ZERO, wallets: new Map(), firstAt: null, firstKey: "" };
      acc.set(t.coinId, a);
    }
    const l = BigInt(t.lamports);
    a.raw += l;
    if (t.user === c.owner || t.user === operator || t.user === c.creator) {
      a.excluded += l;
      continue;
    }
    const before = a.wallets.get(t.user) ?? ZERO;
    const room = r.walletCap > before ? r.walletCap - before : ZERO;
    const take = l < room ? l : room;
    a.wallets.set(t.user, before + take);
    a.counted += take;
    a.capped += l - take;
    if (a.firstAt === null) {
      a.firstAt = t.ts;
      a.firstKey = `${String(t.slot).padStart(14, "0")}:${t.sig}:${t.n}`;
    }
  }
  const rows = [...acc.entries()].map(([coinId, a]) => {
    const traders = a.wallets.size;
    let cappedWallets = 0;
    for (const v of a.wallets.values()) if (v >= r.walletCap) cappedWallets++;
    return { coinId, a, traders, cappedWallets, qualifies: traders >= r.minTraders && a.counted > ZERO };
  });
  rows.sort((x, y) => {
    if (x.qualifies !== y.qualifies) return x.qualifies ? -1 : 1;
    if (x.a.counted !== y.a.counted) return x.a.counted > y.a.counted ? -1 : 1;
    const fx = x.a.firstAt ?? Number.MAX_SAFE_INTEGER;
    const fy = y.a.firstAt ?? Number.MAX_SAFE_INTEGER;
    if (fx !== fy) return fx - fy;
    return x.a.firstKey < y.a.firstKey ? -1 : x.a.firstKey > y.a.firstKey ? 1 : x.coinId < y.coinId ? -1 : 1;
  });
  let rank = 0;
  return rows.map((x) => ({
    coinId: x.coinId,
    raw: x.a.raw.toString(),
    counted: x.a.counted.toString(),
    capped: x.a.capped.toString(),
    excluded: x.a.excluded.toString(),
    traders: x.traders,
    cappedWallets: x.cappedWallets,
    qualifies: x.qualifies,
    rank: x.qualifies ? ++rank : null,
    firstAt: x.a.firstAt,
  }));
}

/** Prizes for a pot: rank i gets floor(pot × prizes[i] / 100) when a qualifying coin holds it. Sum ≤ pot. */
export function splitPot(pot: bigint, qualifiers: number, prizes: number[] = rules().prizes): { amounts: bigint[]; rollover: bigint } {
  const amounts: bigint[] = [];
  let paid = ZERO;
  for (let i = 0; i < prizes.length && i < qualifiers; i++) {
    const a = (pot * BigInt(prizes[i])) / BigInt(100);
    amounts.push(a);
    paid += a;
  }
  return { amounts, rollover: pot - paid };
}

/** What rolled over from the last settled week (0 before the first settlement). */
export function carry(db: DatabaseSync): bigint {
  return BigInt(kvGet(db, "carry") ?? "0");
}

/** The pot of the open week: its pot share of fees + what rolled over from the week just settled. */
export function openPot(db: DatabaseSync, week: number): { fromFees: bigint; rollover: bigint; total: bigint } {
  const fromFees = potOfWeek(db, week);
  const rollover = settledThrough(db) === week - 1 ? carry(db) : ZERO;
  return { fromFees, rollover, total: fromFees + rollover };
}

export interface WeekRow {
  week: number;
  startAt: number;
  endAt: number;
  potIn: string;
  rolloverIn: string;
  pot: string;
  prizes: string;
  rolloverOut: string;
  standings: string;
  settledAt: number;
}

export interface PrizeRow {
  week: number;
  rank: number;
  coinId: string;
  wallet: string;
  lamports: string;
  status: string;
  sig: string | null;
  error: string | null;
  paidAt: number | null;
}

export function getWeek(db: DatabaseSync, week: number): WeekRow | null {
  return (db.prepare("SELECT * FROM weeks WHERE week = ?").get(week) as unknown as WeekRow | undefined) ?? null;
}
export function listWeeks(db: DatabaseSync, limit = 52): WeekRow[] {
  return db.prepare("SELECT * FROM weeks ORDER BY week DESC LIMIT ?").all(limit) as unknown as WeekRow[];
}
export function prizesOf(db: DatabaseSync, week: number): PrizeRow[] {
  return db.prepare("SELECT * FROM prizes WHERE week = ? ORDER BY rank").all(week) as unknown as PrizeRow[];
}
export function prizesOfWallet(db: DatabaseSync, wallet: string): PrizeRow[] {
  return db.prepare("SELECT * FROM prizes WHERE wallet = ? ORDER BY week DESC, rank").all(wallet) as unknown as PrizeRow[];
}

/** Freezes week `week`. Idempotent: a week already in the table is never settled twice. */
export function settle(db: DatabaseSync, week: number, at: number, r: Rules = rules()): WeekRow {
  const existing = getWeek(db, week);
  if (existing) return existing;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (getWeek(db, week)) {
      db.exec("ROLLBACK");
      return getWeek(db, week)!;
    }
    const s = settledThrough(db);
    let potIn = potOfWeek(db, week);
    if (s === null) for (const row of db.prepare("SELECT pot FROM fee_events WHERE potWeek < ?").all(week) as { pot: string }[]) potIn += BigInt(row.pot);
    const rolloverIn = carry(db);
    const pot = potIn + rolloverIn;
    const table = standings(db, week, r);
    const ranked = table.filter((x) => x.rank !== null);
    const { amounts, rollover } = splitPot(pot, ranked.length, r.prizes);
    db.prepare("INSERT INTO weeks (week, startAt, endAt, potIn, rolloverIn, pot, prizes, rolloverOut, standings, settledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      week,
      weekStart(week, r),
      weekEnd(week, r),
      potIn.toString(),
      rolloverIn.toString(),
      pot.toString(),
      JSON.stringify(r.prizes),
      rollover.toString(),
      JSON.stringify(table.slice(0, 50)),
      at,
    );
    amounts.forEach((lamports, i) => {
      const c = getCoin(db, ranked[i].coinId)!;
      db.prepare("INSERT INTO prizes (week, rank, coinId, wallet, lamports, status) VALUES (?, ?, ?, ?, ?, ?)").run(week, i + 1, c.id, c.owner, lamports.toString(), lamports > ZERO ? "owed" : "paid");
    });
    kvSet(db, "carry", rollover.toString());
    kvSet(db, "settledThrough", String(week));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getWeek(db, week)!;
}

/** Settles every finished week not yet settled, oldest first. Returns the weeks settled now. */
export function settleDue(db: DatabaseSync, nowMs: number, r: Rules = rules()): number[] {
  const current = weekOf(nowMs, r);
  const s = settledThrough(db);
  let from: number;
  if (s !== null) from = s + 1;
  else {
    const first = db.prepare("SELECT MIN(w) AS w FROM (SELECT MIN(week) AS w FROM trades UNION ALL SELECT MIN(potWeek) AS w FROM fee_events)").get() as { w: number | null };
    from = first.w ?? current;
  }
  const done: number[] = [];
  for (let w = from; w < current; w++) {
    settle(db, w, nowMs, r);
    done.push(w);
  }
  return done;
}

type Sender = (to: string, lamports: bigint, note: string, db: DatabaseSync, memo: string, kind: string, coinId: string) => Promise<PayoutResult>;
const defaultSender: Sender = (to, lamports, note, db, memo, kind, coinId) => sendSol(to, lamports, note, db, memo, kind, coinId);

/** Sends every owed prize. Marked "sending" before the transfer so two ticks cannot pay it twice. */
export async function payPrizes(db: DatabaseSync = defaultDb(), send: Sender = defaultSender): Promise<{ paid: number; failed: number; skipped?: string }> {
  if (!operatorKeypair() && send === defaultSender) return { paid: 0, failed: 0, skipped: "no operator key" };
  const owed = db.prepare("SELECT * FROM prizes WHERE status = 'owed' ORDER BY week, rank").all() as unknown as PrizeRow[];
  let paid = 0;
  let failed = 0;
  for (const p of owed) {
    const claimed = db.prepare("UPDATE prizes SET status = 'sending' WHERE week = ? AND rank = ? AND status = 'owed'").run(p.week, p.rank);
    if (Number(claimed.changes) === 0) continue;
    const c = getCoin(db, p.coinId);
    let result: PayoutResult;
    try {
      result = await send(p.wallet, BigInt(p.lamports), `week ${p.week} prize, rank ${p.rank}${c ? ` ($${c.ticker})` : ""}`, db, `volumepad week ${p.week} rank ${p.rank}`, "prize", p.coinId);
    } catch {
      result = { error: "The prize could not be sent." };
    }
    if ("sig" in result) {
      db.prepare("UPDATE prizes SET status = 'paid', sig = ?, error = NULL, paidAt = ? WHERE week = ? AND rank = ?").run(result.sig, Date.now(), p.week, p.rank);
      paid++;
    } else {
      db.prepare("UPDATE prizes SET status = 'owed', error = ? WHERE week = ? AND rank = ?").run(result.error.slice(0, 200), p.week, p.rank);
      failed++;
    }
  }
  return { paid, failed };
}

/** Coins of the week with their standing (for pages). */
export function coinsById(db: DatabaseSync): Map<string, CoinRow> {
  return new Map(listCoins(db, 10_000).map((c) => [c.id, c]));
}
