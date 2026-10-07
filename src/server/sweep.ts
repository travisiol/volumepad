/**
 * Creator fees and trades. Nothing loops: `attribute()` runs inside `runTick()` (tick.ts) from `/api/tick` (cron)
 * or from `after()` on a page load when overdue.
 *  attribute(): reads each launched coin's bonding-curve signatures since its cursor, parses pump.fun TradeEvent
 *               logs, records every trade once (wallet, SOL amount, timestamp → week) for the leaderboard, and
 *               records each `creator_fee` once, split three ways: launcher (withdrawable), weekly pot, platform
 *               ($VOLUMEPAD buy & burn, burn.ts).
 *  claim():     collects the operator's pump.fun creator vault when ≥ MIN_CLAIM_LAMPORTS.
 *  withdraw():  the signed-in launcher takes their whole available balance (≥ MIN_PAYOUT_LAMPORTS).
 */
import type { DatabaseSync } from "node:sqlite";
import { PublicKey } from "@solana/web3.js";
import { MIN_CLAIM_LAMPORTS, MIN_PAYOUT_LAMPORTS, SIGS_PER_COIN, rules, splitFee, weekOf } from "../config/volumepad.ts";
import { clearChainCache, connection, creatorClaimable } from "./chain.ts";
import { db as defaultDb } from "./db.ts";
import { HttpError } from "./errors.ts";
import { PAYOUTS_CLOSED, operatorKeypair, sendAndRecord, sendSol } from "./operator.ts";
import type { PayoutResult } from "./operator.ts";
import { bondingCurvePda, collectCreatorFeeInstruction } from "./pump/instructions.ts";
import { parseEventLogs } from "./pump/events.ts";
import { creditFee, kvGet, kvSet, listCoins, ownerBalance, recordTrade, setOwnerPaid, updateCoin } from "./store.ts";

export interface Cursor {
  lastSig: string | null;
  pendingNewest: string | null;
  beforeSig: string | null;
}

export interface ScannedTrade {
  n: number;
  user: string;
  lamports: bigint;
  isBuy: boolean;
  ts: number;
}

export interface ScannedTx {
  sig: string;
  slot: number;
  ts: number;
  creatorFee: bigint;
  trades: ScannedTrade[];
}

export async function scanMint(mint: string, creator: string | null, cursor: Cursor): Promise<{ txs: ScannedTx[]; cursor: Cursor }> {
  const conn = connection();
  const curve = bondingCurvePda(new PublicKey(mint));
  const page = await conn.getSignaturesForAddress(curve, { limit: SIGS_PER_COIN, until: cursor.lastSig ?? undefined, before: cursor.beforeSig ?? undefined }, "confirmed");
  const next: Cursor = { ...cursor };
  if (!next.pendingNewest && page.length) next.pendingNewest = page[0].signature;
  const txs: ScannedTx[] = [];
  for (const s of [...page].reverse()) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    const blockMs = (tx?.blockTime ?? s.blockTime ?? 0) * 1000;
    let creatorFee = BigInt(0);
    const trades: ScannedTrade[] = [];
    let n = 0;
    for (const e of parseEventLogs(tx?.meta?.logMessages ?? [])) {
      if (e.kind !== "trade" || e.mint !== mint) continue;
      const ts = Number(e.timestamp) > 0 ? Number(e.timestamp) * 1000 : blockMs;
      trades.push({ n: n++, user: e.user, lamports: e.solAmount, isBuy: e.isBuy, ts });
      if (!creator || e.creator === creator) creatorFee += e.creatorFee;
    }
    if (trades.length) txs.push({ sig: s.signature, slot: s.slot, ts: trades[0].ts, creatorFee, trades });
  }
  if (page.length >= SIGS_PER_COIN) {
    next.beforeSig = page[page.length - 1].signature;
  } else {
    next.lastSig = next.pendingNewest ?? next.lastSig;
    next.pendingNewest = null;
    next.beforeSig = null;
  }
  return { txs, cursor: next };
}

/** The last settled week (kv), or null before the first settlement. */
export function settledThrough(db: DatabaseSync): number | null {
  const v = kvGet(db, "settledThrough");
  return v === null ? null : Number(v);
}

/** The week a pot share is credited to: the week of the trade, or the first open week if that one is settled. */
export function potWeekFor(db: DatabaseSync, tsMs: number): number {
  const w = weekOf(tsMs);
  const s = settledThrough(db);
  return s !== null && w <= s ? s + 1 : w;
}

export interface AttributeResult {
  coins: number;
  trades: number;
  events: number;
  launcherLamports: bigint;
  potLamports: bigint;
  platformLamports: bigint;
}

export async function attribute(db: DatabaseSync = defaultDb()): Promise<AttributeResult> {
  const out: AttributeResult = { coins: 0, trades: 0, events: 0, launcherLamports: BigInt(0), potLamports: BigInt(0), platformLamports: BigInt(0) };
  const r = rules();
  for (const p of listCoins(db, 10_000)) {
    out.coins++;
    try {
      const { txs, cursor } = await scanMint(p.mint, p.creator, { lastSig: p.lastSig, pendingNewest: p.pendingNewest, beforeSig: p.beforeSig });
      for (const t of txs) {
        for (const tr of t.trades) {
          if (recordTrade(db, { sig: t.sig, n: tr.n, coinId: p.id, user: tr.user, lamports: tr.lamports.toString(), isBuy: tr.isBuy ? 1 : 0, ts: tr.ts, slot: t.slot, week: weekOf(tr.ts, r) })) out.trades++;
        }
        if (t.creatorFee <= BigInt(0)) continue;
        const { launcher, pot, platform } = splitFee(t.creatorFee);
        if (creditFee(db, { mint: p.mint, sig: t.sig, slot: t.slot, ts: t.ts, lamports: t.creatorFee, coinId: p.id, owner: p.owner, ownerShare: launcher, pot, platform, potWeek: potWeekFor(db, t.ts) })) {
          out.events++;
          out.launcherLamports += launcher;
          out.potLamports += pot;
          out.platformLamports += platform;
        }
      }
      updateCoin(db, p.id, cursor);
    } catch {
      // RPC refused this coin; its cursor is unchanged and the next tick retries.
    }
  }
  return out;
}

export type StepResult = { skipped: string } | { sig: string; lamports: bigint } | { error: string };

export async function claim(db: DatabaseSync = defaultDb()): Promise<StepResult> {
  const operator = operatorKeypair();
  if (!operator) return { skipped: "no operator key" };
  // Read fresh: a cached balance from before the last claim would claim (and count) the same fees twice.
  const { curveLamports } = await creatorClaimable(operator.publicKey.toBase58(), true);
  if (curveLamports < MIN_CLAIM_LAMPORTS) return { skipped: "under the claim minimum" };
  const result = await sendAndRecord(
    operator,
    [collectCreatorFeeInstruction(operator.publicKey)],
    { kind: "claim", to: operator.publicKey.toBase58(), mint: null, amount: curveLamports, note: "creator fees collected from pump.fun" },
    db,
  );
  if ("sig" in result) {
    clearChainCache();
    kvSet(db, "claimedLamports", (BigInt(kvGet(db, "claimedLamports") ?? "0") + curveLamports).toString());
    return { sig: result.sig, lamports: curveLamports };
  }
  return result;
}

type Sender = (to: string, lamports: bigint, note: string, db: DatabaseSync, memo: string) => Promise<PayoutResult>;
const defaultSender: Sender = (to, lamports, note, db, memo) => sendSol(to, lamports, note, db, memo, "withdraw");

/** Pays the launcher's whole available balance. Reserved before sending so a second request cannot pay twice. */
export async function withdraw(owner: string | null, db: DatabaseSync = defaultDb(), send: Sender = defaultSender): Promise<{ sig: string; lamports: string }> {
  if (!owner) throw new HttpError(401, "Sign in with your wallet first.");
  const { available, paid } = ownerBalance(db, owner);
  if (available < MIN_PAYOUT_LAMPORTS) throw new HttpError(400, "You have less than 0.001 SOL to withdraw.");
  if (!operatorKeypair() && send === defaultSender) throw new HttpError(503, PAYOUTS_CLOSED);
  setOwnerPaid(db, owner, paid + available);
  let result: PayoutResult;
  try {
    result = await send(owner, available, "launcher share of creator fees withdrawn", db, `volumepad fees ${owner.slice(0, 8)}`);
  } catch {
    result = { error: "The payout could not be sent." };
  }
  if ("error" in result) {
    setOwnerPaid(db, owner, paid);
    throw new HttpError(502, result.error);
  }
  return { sig: result.sig, lamports: available.toString() };
}
